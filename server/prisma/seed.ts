import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // 清理旧数据
  await prisma.takeaway.deleteMany();
  await prisma.video.deleteMany();

  // 创建示例视频
  const video = await prisma.video.create({
    data: {
      videoId: 'dQw4w9WgXcQ',
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      title: 'Sample Video - AI Video Highlights Demo',
      takeaways: {
        create: [
          {
            title: 'Introduction & Overview',
            summary: 'The video starts with an introduction to the main topic and sets the context for viewers.',
            timestamp: 0,
            duration: '0:00 - 1:30',
            sortOrder: 0,
          },
          {
            title: 'Core Concept Explained',
            summary: 'The speaker dives into the central idea, breaking down the key components and how they relate to each other.',
            timestamp: 90,
            duration: '1:30 - 4:00',
            sortOrder: 1,
          },
          {
            title: 'Practical Examples',
            summary: 'Real-world examples are presented to illustrate how the concept can be applied in various scenarios.',
            timestamp: 240,
            duration: '4:00 - 6:30',
            sortOrder: 2,
          },
        ],
      },
    },
  });

  console.log(`✅ Created video: ${video.title} (${video.videoId})`);
  console.log(`✅ Created 3 takeaways`);
  console.log('🌱 Seeding complete!');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
