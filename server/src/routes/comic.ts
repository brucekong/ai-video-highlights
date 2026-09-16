import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { spawn, exec } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import fs from 'fs-extra';
import { pipeline } from 'node:stream/promises';
import prisma from '../lib/prisma.js';
import { resolveFfmpegLocation } from '../services/ytdlp.js';
import { findCachedFullVideoPath, ensureClipSourceVideo } from '../services/clipping.js';
import { getPreferredTranscriptForVideo } from '../services/subtitleCues.js';

const execAsync = promisify(exec);
const TEMP_COMIC_DIR = path.join(process.cwd(), 'cache', 'comic-temp');

/**
 * 清理字幕文本：移除 HTML 实体转义、音效标记（如 [Music]、[crying] 等），保留清晰英文字幕
 */
export function cleanSubtitleText(text: string): string {
  if (!text) return '';
  return text
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\[.*?\]/g, '') // 去除 [Music], [crying], [Applause] 等音效标签
    .replace(/\(.*?\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 寻找未烧录中文字幕和水印的纯净原画视频文件
 * 确保连环画抽帧只截取原生动画画面与原片自带英文字幕，绝不带中文字幕
 */
export async function findCleanSourceVideoPath(videoId: string): Promise<string | null> {
  const CLIPS_DIR = path.join(process.cwd(), 'cache', 'clips');
  if (!(await fs.pathExists(CLIPS_DIR))) return null;

  const files = await fs.readdir(CLIPS_DIR).catch(() => []);

  // 1. 优先找未经中文字幕烧录的 raw / clean 视频
  const rawMatch = files.find(
    (f) =>
      f.endsWith('.mp4') &&
      f.includes(videoId) &&
      (f.includes('_raw') || f.includes('_prepared') || f.includes('_source_')) &&
      !f.includes('_burned_') &&
      !f.includes('_zh_')
  );
  if (rawMatch) return path.join(CLIPS_DIR, rawMatch);

  // 2. 找任意包含 videoId 且不含 _burned_ 和 _zh_ 的 mp4
  const cleanMatch = files.find(
    (f) =>
      f.endsWith('.mp4') &&
      f.includes(videoId) &&
      !f.includes('_burned_') &&
      !f.includes('_zh_')
  );
  if (cleanMatch) return path.join(CLIPS_DIR, cleanMatch);

  // 3. 兜底回退
  return await findCachedFullVideoPath(videoId);
}

/**
 * 利用 FFmpeg 智能检测画面镜头切变点 (Scene Cut Detection)
 * 避开无脑均分造成的重复人脸和单调镜头
 */
async function detectSceneChanges(
  ffmpegLocation: string,
  videoPath: string,
  start: number,
  duration: number,
  minIntervalSec: number = 2.5,
  threshold: number = 0.25
): Promise<number[]> {
  // -filter_complex select='gt(scene,threshold)' 快速提取画面像素大变化的相对秒数
  const cmd = `"${ffmpegLocation}" -ss ${start} -t ${duration} -i "${videoPath}" -filter_complex "select='gt(scene,${threshold})',metadata=print" -f null -`;
  try {
    const { stderr } = await execAsync(cmd, { maxBuffer: 10 * 1024 * 1024 });
    const matches = [...stderr.matchAll(/pts_time:([0-9.]+)/g)].map((m) => parseFloat(m[1]));

    const cuts: number[] = [0]; // 首帧从相对 0 秒开始
    for (const relTime of matches) {
      if (relTime > 0.5 && relTime - cuts[cuts.length - 1] >= minIntervalSec) {
        cuts.push(relTime);
      }
    }
    return cuts;
  } catch (e) {
    return [0];
  }
}

export async function comicRoutes(fastify: FastifyInstance) {
  await fs.ensureDir(TEMP_COMIC_DIR);

  /**
   * GET /api/comic/videos
   * 获取所有可用于制作连环画的已分析视频及核心故事摘要列表
   */
  fastify.get('/api/comic/videos', {
    schema: {
      tags: ['Comic'],
      summary: '获取已分析的视频与核心故事切片列表',
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              videoId: { type: 'string' },
              title: { type: 'string' },
              duration: { type: 'number' },
              takeaways: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    title: { type: 'string' },
                    storyTitle: { type: 'string' },
                    timestamp: { type: 'number' },
                    duration: { type: 'string' }
                  }
                }
              }
            }
          }
        }
      }
    }
  }, async (_request, reply) => {
    const videos = await prisma.video.findMany({
      select: {
        videoId: true,
        title: true,
        duration: true,
        takeaways: {
          select: {
            id: true,
            title: true,
            storyTitle: true,
            timestamp: true,
            duration: true
          },
          orderBy: { sortOrder: 'asc' }
        }
      },
      orderBy: { updatedAt: 'desc' },
      take: 30
    });

    return reply.send(videos);
  });

  /**
   * GET /api/videos/:videoId/comic/data
   * 智能自动识别：精准对齐硬字幕关键帧 + 画面镜头切变检测
   */
  fastify.get('/api/videos/:videoId/comic/data', {
    schema: {
      tags: ['Comic'],
      summary: '自动识别并获取连环画分镜与字幕',
      params: {
        type: 'object',
        required: ['videoId'],
        properties: {
          videoId: { type: 'string' }
        }
      },
      querystring: {
        type: 'object',
        properties: {
          start: { type: 'number' },
          end: { type: 'number' },
          takeawayIndex: { type: 'number' },
          autoDetect: { type: 'string' }
        }
      }
    }
  }, async (request: FastifyRequest<{
    Params: { videoId: string };
    Querystring: { start?: number; end?: number; takeawayIndex?: number; autoDetect?: string };
  }>, reply: FastifyReply) => {
    const { videoId } = request.params;
    let { start, end, takeawayIndex, autoDetect = 'true' } = request.query;

    const video = await prisma.video.findUnique({
      where: { videoId },
      select: {
        videoId: true,
        title: true,
        url: true,
        platform: true,
        duration: true,
        takeaways: {
          orderBy: { sortOrder: 'asc' }
        }
      }
    });

    if (!video) {
      return reply.status(404).send({ error: '视频不存在' });
    }

    let clipTitle = video.title || '连环画故事';
    let storyTitle = '';

    function parseDurationToSeconds(durStr: string | null | undefined): number {
      if (!durStr) return 60;
      const str = String(durStr).trim();
      if (str.includes(':')) {
        const parts = str.split(':').map((p) => parseFloat(p) || 0);
        if (parts.length === 2) {
          return parts[0] * 60 + parts[1];
        } else if (parts.length === 3) {
          return parts[0] * 3600 + parts[1] * 60 + parts[2];
        }
      }
      const parsed = parseFloat(str);
      return isNaN(parsed) ? 60 : parsed;
    }

    // 如果指定了核心摘要 takeawayIndex，优先使用其时间区间与标题
    if (takeawayIndex !== undefined && Array.isArray(video.takeaways)) {
      const takeaway = video.takeaways[takeawayIndex];
      if (takeaway) {
        const takeawayDuration = parseDurationToSeconds(takeaway.duration);
        if (start === undefined) start = takeaway.timestamp;
        if (end === undefined) end = takeaway.timestamp + takeawayDuration;
        clipTitle = takeaway.title || clipTitle;
        storyTitle = takeaway.storyTitle || '';
      }
    }

    const safeStart = Math.max(0, start !== undefined ? start : 0);
    const safeEnd = end !== undefined ? end : (video.duration ? video.duration : safeStart + 180);
    const clipDuration = Math.max(5, safeEnd - safeStart);

    // 获取全局字幕 / Cues
    const allTranscript = await getPreferredTranscriptForVideo(prisma, videoId);
    const startMs = safeStart * 1000;
    const endMs = safeEnd * 1000;

    const clipSegments = allTranscript.filter((seg) => {
      const segStart = seg.offset;
      const segEnd = seg.offset + seg.duration;
      return segEnd >= startMs && segStart <= endMs;
    });

    const cachedCleanVideo = await findCleanSourceVideoPath(videoId);
    const ffmpegLocation = resolveFfmpegLocation();

    interface ComicScene {
      id: string;
      index: number;
      time: number; // 抽帧时间点（秒）
      start: number;
      end: number;
      text: string;
      translatedText?: string;
      shotType?: string;
    }

    const scenes: ComicScene[] = [];

    // 1. 过滤清洗字幕，提取每一个真实的台词段落
    const validCues = clipSegments
      .map((seg) => {
        const rawText = cleanSubtitleText(seg.text);
        const startSec = seg.offset / 1000;
        const durationSec = seg.duration / 1000;
        const endSec = startSec + durationSec;
        return {
          rawText,
          startSec,
          durationSec,
          endSec,
        };
      })
      .filter((cue) => {
        // 过滤非文字或过短噪音标记
        const meaningful = cue.rawText.replace(/[^a-zA-Z0-9]/g, '');
        return meaningful.length >= 2;
      });

    // 2. 如果存在字幕：以每一句对白/硬字幕区间作为连环画核心骨干
    if (validCues.length > 0) {
      // 提取视觉镜头切变作为辅助（用于补充长静音区间的场景转场画面）
      let visualCuts: number[] = [];
      if (autoDetect !== 'false' && cachedCleanVideo && ffmpegLocation) {
        visualCuts = await detectSceneChanges(ffmpegLocation, cachedCleanVideo, safeStart, clipDuration, 3.0, 0.28).catch(() => []);
      }

      for (let i = 0; i < validCues.length; i++) {
        const cue = validCues[i];

        // 去重：如果连续两句台词完全相同且时间差极小，跳过重复
        if (i > 0 && cue.rawText === validCues[i - 1].rawText && cue.startSec - validCues[i - 1].startSec < 1.0) {
          continue;
        }

        // 如果距离上一句对白有超过 5.0 秒的静音空白，且中间发生了镜头切换，插入一个环境/动作转场分镜
        if (i > 0 && visualCuts.length > 0) {
          const prevCue = validCues[i - 1];
          const gap = cue.startSec - prevCue.endSec;
          if (gap >= 5.0) {
            const cutInGap = visualCuts.find((c) => {
              const absCut = safeStart + c;
              return absCut > prevCue.endSec + 1.0 && absCut < cue.startSec - 1.2;
            });
            if (cutInGap) {
              const absCutTime = Number((safeStart + cutInGap + 0.6).toFixed(2));
              scenes.push({
                id: `scene_action_${scenes.length + 1}`,
                index: scenes.length + 1,
                time: absCutTime,
                start: Number((safeStart + cutInGap).toFixed(2)),
                end: Number((safeStart + cutInGap + 2.5).toFixed(2)),
                text: '',
                shotType: 'action-cut',
              });
            }
          }
        }

        // 核心精准对齐：抽帧时间定在原片硬字幕必然展示的黄金区间
        // 采样在台词开始后 2.0s ~ 3.0s（若短句则在 50% 处），确保 100% 捕获带原片硬字幕的高清画面与生动表情
        const optimalOffset = cue.durationSec <= 2.5
          ? Math.max(0.5, cue.durationSec * 0.5)
          : Math.min(3.0, Math.max(1.8, cue.durationSec * 0.35));
        const frameTime = Number((cue.startSec + optimalOffset).toFixed(2));

        scenes.push({
          id: `scene_dialogue_${scenes.length + 1}`,
          index: scenes.length + 1,
          time: frameTime,
          start: Number(cue.startSec.toFixed(2)),
          end: Number(cue.endSec.toFixed(2)),
          text: cue.rawText,
          shotType: 'dialogue',
        });
      }
    } else {
      // 3. 兜底方案：如果没有字幕，使用纯视觉镜头切变检测
      let detectedCuts: number[] = [];
      if (autoDetect !== 'false' && cachedCleanVideo && ffmpegLocation) {
        detectedCuts = await detectSceneChanges(ffmpegLocation, cachedCleanVideo, safeStart, clipDuration, 2.5, 0.25);
      }

      if (detectedCuts.length < 2) {
        // 等分切 8 格
        const count = 8;
        const step = clipDuration / count;
        for (let i = 0; i < count; i++) {
          const sTime = Number((safeStart + i * step + step * 0.3).toFixed(2));
          scenes.push({
            id: `scene_fallback_${i + 1}`,
            index: i + 1,
            time: sTime,
            start: Number((safeStart + i * step).toFixed(2)),
            end: Number((safeStart + (i + 1) * step).toFixed(2)),
            text: '',
            shotType: 'fallback',
          });
        }
      } else {
        for (let i = 0; i < detectedCuts.length; i++) {
          const relStart = detectedCuts[i];
          const relEnd = i < detectedCuts.length - 1 ? detectedCuts[i + 1] : clipDuration;
          const absStart = safeStart + relStart;
          const absEnd = safeStart + relEnd;
          const frameTime = Number((absStart + Math.min(0.8, (absEnd - absStart) * 0.4)).toFixed(2));

          scenes.push({
            id: `scene_cut_${i + 1}`,
            index: i + 1,
            time: frameTime,
            start: Number(absStart.toFixed(2)),
            end: Number(absEnd.toFixed(2)),
            text: '',
            shotType: 'auto-cut',
          });
        }
      }
    }

    return reply.send({
      videoId,
      title: clipTitle,
      storyTitle,
      start: safeStart,
      end: safeEnd,
      hasVideoCache: !!cachedCleanVideo,
      autoDetected: true,
      scenes,
    });
  });

  /**
   * POST /api/video/comic/auto-detect-local
   * 上传本地视频并自动识别镜头与字幕（如文件名包含系统已有视频 ID，自动关联匹配）
   */
  fastify.post('/api/video/comic/auto-detect-local', {
    schema: {
      tags: ['Comic'],
      summary: '自动识别本地上传视频的镜头切变与字幕',
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const data = await request.file();
    if (!data) {
      return reply.status(400).send({ error: '未上传视频文件' });
    }

    const fileId = `${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const originalExt = path.extname(data.filename) || '.mp4';
    const tempVideoPath = path.join(TEMP_COMIC_DIR, `local_${fileId}${originalExt}`);

    try {
      const writeStream = fs.createWriteStream(tempVideoPath);
      await pipeline(data.file, writeStream);

      const ffmpegLocation = resolveFfmpegLocation();
      if (!ffmpegLocation) {
        throw new Error('当前环境未安装 ffmpeg');
      }

      // 获取视频总时长
      const probeCmd = `"${ffmpegLocation}" -i "${tempVideoPath}" 2>&1`;
      const { stderr: probeStderr } = await execAsync(probeCmd).catch((e) => e);
      const durMatch = probeStderr.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
      let durationSec = 60;
      if (durMatch) {
        durationSec = parseInt(durMatch[1]) * 3600 + parseInt(durMatch[2]) * 60 + parseFloat(durMatch[3]);
      }

      // 检查文件名是否命中已有视频 ID
      const allVideos = await prisma.video.findMany({
        select: { videoId: true, title: true }
      });
      const matchedVideo = allVideos.find((v) => data.filename.includes(v.videoId));

      let matchedTranscript: any[] = [];
      let storyTitle = '';
      if (matchedVideo) {
        matchedTranscript = await getPreferredTranscriptForVideo(prisma, matchedVideo.videoId);
      }

      // 自动识别镜头切变
      const cuts = await detectSceneChanges(ffmpegLocation, tempVideoPath, 0, durationSec, 3.0, 0.25);
      const scenes: any[] = [];

      for (let i = 0; i < cuts.length; i++) {
        const sStart = cuts[i];
        const sEnd = i < cuts.length - 1 ? cuts[i + 1] : durationSec;
        const frameTime = Number((sStart + Math.min(0.8, (sEnd - sStart) * 0.4)).toFixed(2));

        // 提取该帧为 Base64 JPEG
        const frameCmd = `"${ffmpegLocation}" -ss ${frameTime} -i "${tempVideoPath}" -vframes 1 -q:v 2 -f image2 -update 1 pipe:1`;
        const { stdout: frameBuffer } = await execAsync(frameCmd, { encoding: 'buffer', maxBuffer: 5 * 1024 * 1024 });
        const base64Img = `data:image/jpeg;base64,${frameBuffer.toString('base64')}`;

        // 匹配字幕
        let text = '';
        let translatedText = '';
        if (matchedTranscript.length > 0) {
          const inRange = matchedTranscript.filter((s) => {
            const ss = s.offset / 1000;
            const se = (s.offset + s.duration) / 1000;
            return se >= sStart && ss <= sEnd;
          });
          text = inRange.map((s) => s.text).join(' ');
          translatedText = inRange.map((s) => s.translatedText || s.text).join('，');
        }

        scenes.push({
          id: `local_cut_${i + 1}`,
          index: i + 1,
          time: frameTime,
          start: sStart,
          end: sEnd,
          text: text,
          translatedText: translatedText || `第 ${i + 1} 幕精彩分镜`,
          customImageSrc: base64Img,
        });
      }

      // 异步清理临时视频
      fs.remove(tempVideoPath).catch(() => {});

      return reply.send({
        title: matchedVideo ? matchedVideo.title : data.filename.replace(/\.[^/.]+$/, ''),
        storyTitle,
        duration: durationSec,
        matchedVideoId: matchedVideo?.videoId,
        scenes,
      });

    } catch (err: any) {
      fs.remove(tempVideoPath).catch(() => {});
      request.log.error(err, '[Comic Local Detect] Failed');
      return reply.status(500).send({ error: '自动识别镜头失败', message: err.message });
    }
  });

  /**
   * GET /api/videos/:videoId/comic/frame
   * 实时毫秒抽取指定秒数的单帧画面并流式返回 JPEG
   */
  fastify.get('/api/videos/:videoId/comic/frame', {
    schema: {
      tags: ['Comic'],
      summary: '实时抽取指定时间戳的视频单帧画面',
      params: {
        type: 'object',
        required: ['videoId'],
        properties: {
          videoId: { type: 'string' }
        }
      },
      querystring: {
        type: 'object',
        required: ['time'],
        properties: {
          time: { type: 'number', description: '截取的时间点（秒，浮点数）' }
        }
      }
    }
  }, async (request: FastifyRequest<{
    Params: { videoId: string };
    Querystring: { time: number };
  }>, reply: FastifyReply) => {
    const { videoId } = request.params;
    const { time } = request.query;

    if (isNaN(time) || time < 0) {
      return reply.status(400).send({ error: '无效的时间戳' });
    }

    const video = await prisma.video.findUnique({
      where: { videoId },
      select: { videoId: true, title: true, url: true, platform: true }
    });

    if (!video) {
      return reply.status(404).send({ error: '视频不存在' });
    }

    let sourcePath = await findCleanSourceVideoPath(videoId);
    if (!sourcePath) {
      try {
        sourcePath = await ensureClipSourceVideo({
          videoId,
          title: video.title || 'video',
          url: video.url,
          platform: video.platform,
          quality: '1080',
        });
      } catch (err: any) {
        request.log.error(err, '[Comic Frame] Ensure source video failed');
        return reply.status(500).send({ error: '下载并准备视频源失败，无法抽帧' });
      }
    }

    const ffmpegLocation = resolveFfmpegLocation();
    if (!ffmpegLocation) {
      return reply.status(500).send({ error: '系统未检测到 ffmpeg' });
    }

    // 利用 ffmpeg 的快速 seek 抽取单帧 JPEG 直接输出到 stdout pipe
    const ffmpegProc = spawn(ffmpegLocation, [
      '-ss', time.toString(),
      '-i', sourcePath,
      '-vframes', '1',
      '-q:v', '2',
      '-f', 'image2',
      '-update', '1',
      'pipe:1'
    ]);

    reply.header('Content-Type', 'image/jpeg');
    reply.header('Cache-Control', 'public, max-age=86400');

    let hasSent = false;

    ffmpegProc.on('error', (err) => {
      request.log.error(err, '[Comic Frame] FFmpeg process error');
      if (!hasSent) {
        hasSent = true;
        reply.status(500).send({ error: '抽帧处理异常' });
      }
    });

    return reply.send(ffmpegProc.stdout);
  });
}
