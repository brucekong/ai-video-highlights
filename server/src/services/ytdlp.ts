import fs from 'fs-extra';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

type YtDlpFlags = Record<string, any>;

interface DownloadWithFallbackOptions {
  cookieFile?: string;
  cookieContents?: string;
  context?: string;
  isYoutube?: boolean;
}

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

function resolveBinary(binaryName: string): string | undefined {
  const result = spawnSync('which', [binaryName], { encoding: 'utf8' });
  const resolved = result.status === 0 ? result.stdout.trim() : '';
  return resolved || undefined;
}

function resolveJsRuntime(): string | undefined {
  const configured = (process.env.YTDLP_JS_RUNTIMES || '').trim();
  const configuredCandidates = configured
    ? configured.split(/[,\s]+/).filter(Boolean)
    : [];

  const candidates = configuredCandidates.length > 0
    ? configuredCandidates
    : ['deno', 'node', 'bun', 'quickjs'];

  for (const candidate of candidates) {
    const [name, explicitPath] = candidate.split(':', 2);
    if (explicitPath) {
      return `${name}:${explicitPath}`;
    }

    const binaryPath = resolveBinary(name);
    if (binaryPath) {
      return `${name}:${binaryPath}`;
    }
  }

  return undefined;
}

function resolveFfmpegLocation(): string | undefined {
  const configured = (process.env.FFMPEG_PATH || process.env.FFMPEG_BINARY || '').trim();
  if (configured) {
    try {
      const stat = fs.statSync(configured);
      if (stat.isDirectory()) {
        const exeName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
        const candidate = path.join(configured, exeName);
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      }
    } catch (e) {
      // 忽略文件不存在等异常，直接返回原配置
    }
    return configured;
  }

  return resolveBinary('ffmpeg');
}

export function buildYtDlpBaseFlags(flags: YtDlpFlags = {}): YtDlpFlags {
  const headers = Array.isArray(flags.addHeader) ? [...flags.addHeader] : [];
  const jsRuntimes = resolveJsRuntime();
  const ffmpegLocation = resolveFfmpegLocation();

  if (!headers.some((header) => String(header).toLowerCase().startsWith('accept-language:'))) {
    headers.push('accept-language:zh-CN,zh;q=0.9,en;q=0.8');
  }

  return {
    noCheckCertificates: true,
    forceIpv4: true,
    remoteComponents: 'ejs:github',
    retries: 3,
    fragmentRetries: 3,
    fileAccessRetries: 3,
    socketTimeout: 30,
    ...(jsRuntimes ? { jsRuntimes } : {}),
    ...(ffmpegLocation ? { ffmpegLocation } : {}),
    userAgent: flags.userAgent || process.env.YTDLP_USER_AGENT || DEFAULT_USER_AGENT,
    addHeader: headers,
    ...flags,
  };
}

export { resolveFfmpegLocation };

export async function downloadWithYtDlpFallback(
  youtubedl: (url: string, flags: YtDlpFlags) => Promise<any>,
  url: string,
  flags: YtDlpFlags,
  options: DownloadWithFallbackOptions = {},
): Promise<void> {
  const { cookieContents, cookieFile, context = 'yt-dlp', isYoutube = false } = options;
  const baseFlags = buildYtDlpBaseFlags(flags);
  const attempts: Array<{ label: string; flags: YtDlpFlags }> = [];

  if (isYoutube) {
    if (cookieContents && cookieFile) {
      await fs.writeFile(cookieFile, cookieContents.replace(/\\n/g, '\n'));
      attempts.push({
        label: 'with env cookies',
        flags: { ...baseFlags, cookies: cookieFile },
      });
    }

    const localCookiesTxt = path.join(process.cwd(), 'cookies.txt');
    if (fs.existsSync(localCookiesTxt)) {
      attempts.push({
        label: 'with local cookies.txt',
        flags: { ...baseFlags, cookies: localCookiesTxt },
      });
    }

    attempts.push({
      label: 'with browser cookies (chrome)',
      flags: { ...baseFlags, cookiesFromBrowser: 'chrome' },
    });
  }

  attempts.push({
    label: attempts.length > 0 ? 'without cookies' : 'default',
    flags: baseFlags,
  });

  let lastError: any;

  for (const attempt of attempts) {
    try {
      console.log(`[yt-dlp] ${context}: starting ${attempt.label}`);
      await youtubedl(url, attempt.flags);
      if (attempt.label === 'without cookies' && attempts.length > 1) {
        console.warn(`[yt-dlp] ${context}: cookies were skipped after a failed authenticated attempt.`);
      }
      return;
    } catch (error: any) {
      lastError = error;
      console.warn(`[yt-dlp] ${context}: ${attempt.label} failed: ${error?.message || error}`);
    }
  }

  throw lastError;
}
