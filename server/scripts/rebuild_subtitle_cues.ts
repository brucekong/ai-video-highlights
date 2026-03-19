import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { rebuildSubtitleCuesForVideo } from '../src/services/subtitleCues.js';

const prisma = new PrismaClient();

async function main() {
  const videos = await prisma.video.findMany({
    select: { videoId: true },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`Found ${videos.length} videos to rebuild subtitle cues.`);

  let rebuilt = 0;

  for (const video of videos) {
    await rebuildSubtitleCuesForVideo(prisma, video.videoId);
    rebuilt += 1;
  }

  console.log(`Rebuilt subtitle cues for ${rebuilt} videos.`);
}

main()
  .catch((error) => {
    console.error('Failed to rebuild subtitle cues:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
