
import { PrismaClient } from '@prisma/client';
import { getEmbedding, getEmbeddings } from '../src/services/ai.js';
import 'dotenv/config';

const prisma = new PrismaClient();

async function backfill() {
  console.log('--- Starting Embedding Backfill ---');

  // 1. 处理视频标题向量
  const videos = await prisma.video.findMany({
    where: {
      embedding: { equals: null } as any
    }
  });

  console.log(`Found ${videos.length} videos without embeddings.`);
  for (const video of videos) {
    if (video.title) {
      try {
        console.log(`Processing video: ${video.title}`);
        const vec = await getEmbedding(video.title);
        const vectorStr = `[${vec.join(',')}]`;
        await prisma.$executeRawUnsafe(
          `UPDATE videos SET embedding = '${vectorStr}'::vector WHERE video_id = $1`,
          video.videoId
        );
      } catch (e: any) {
        console.error(`Failed video ${video.videoId}: ${e.message}`);
      }
    }
  }

  // 2. 处理字幕向量 (重点)
  const subtitles = await prisma.subtitle.findMany({
    where: {
      embedding: null as any
    },
    orderBy: { videoId: 'asc' }
  });

  console.log(`Found ${subtitles.length} subtitles without embeddings.`);

  // 按视频 ID 分组处理，提高效率
  const grouped: Record<string, any[]> = {};
  subtitles.forEach(s => {
    if (!grouped[s.videoId]) grouped[s.videoId] = [];
    grouped[s.videoId].push(s);
  });

  for (const [vId, segments] of Object.entries(grouped)) {
    console.log(`Backfilling ${segments.length} segments for video ${vId}...`);

    // 每 50 条一批
    const BATCH_SIZE = 50;
    for (let i = 0; i < segments.length; i += BATCH_SIZE) {
      const batch = segments.slice(i, i + BATCH_SIZE);
      const texts = batch.map(s => s.translatedText || s.text);

      try {
        const vecs = await getEmbeddings(texts);
        await Promise.all(vecs.map(async (v, idx) => {
          const vectorStr = `[${v.join(',')}]`;
          await prisma.$executeRawUnsafe(
            `UPDATE subtitles SET embedding = '${vectorStr}'::vector WHERE id = $1`,
            batch[idx].id
          );
        }));
      } catch (e: any) {
        console.error(`Failed batch in ${vId}: ${e.message}`);
      }
    }
  }

  console.log('--- Backfill Completed ---');
}

backfill()
  .catch(console.error)
  .finally(async () => await prisma.$disconnect());
