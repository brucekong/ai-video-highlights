import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function cleanMarkerText(value: string | null | undefined): string | null | undefined {
  if (value == null) return value;

  return value
    .replace(/(?:&gt;&gt;|>>)/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.!?;:，。！？；：])/g, '$1')
    .trim();
}

async function main() {
  const subtitles = await prisma.subtitle.findMany({
    where: {
      OR: [
        { text: { contains: '>>' } },
        { text: { contains: '&gt;&gt;' } },
        { translatedText: { contains: '>>' } },
        { translatedText: { contains: '&gt;&gt;' } },
      ],
    },
    select: {
      id: true,
      videoId: true,
      sortOrder: true,
      text: true,
      translatedText: true,
    },
    orderBy: [
      { videoId: 'asc' },
      { sortOrder: 'asc' },
    ],
  });

  console.log(`Found ${subtitles.length} subtitle rows to clean.`);

  let updatedCount = 0;

  for (const subtitle of subtitles) {
    const nextText = cleanMarkerText(subtitle.text);
    const nextTranslatedText = cleanMarkerText(subtitle.translatedText);

    if (nextText === subtitle.text && nextTranslatedText === subtitle.translatedText) {
      continue;
    }

    await prisma.subtitle.update({
      where: { id: subtitle.id },
      data: {
        text: nextText!,
        translatedText: nextTranslatedText,
      },
    });

    updatedCount += 1;
  }

  console.log(`Updated ${updatedCount} subtitle rows.`);
}

main()
  .catch((error) => {
    console.error('Failed to clean subtitle markers:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
