import youtubedl from 'youtube-dl-exec';
import path from 'path';

async function test() {
  const cookiesPath = path.resolve(process.cwd(), 'cookies.txt');
  console.log('Using cookies from:', cookiesPath);
  
  try {
    const result = await youtubedl('https://www.youtube.com/watch?v=6S5dEi0A35E', {
      extractAudio: true, audioFormat: "m4a", format: "worstaudio/bestaudio", output: "test.m4a",
      cookies: cookiesPath,
      noCheckCertificates: true,
      forceIpv4: true,
      remoteComponents: 'ejs:github',
      retries: 3,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    });
    console.log('Success!', result.title);
  } catch (error) {
    console.error('Failed:', error.message);
  }
}

test();
