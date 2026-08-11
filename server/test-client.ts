import youtubedl from 'youtube-dl-exec';
import path from 'path';

async function test() {
  try {
    const result = await youtubedl('https://www.youtube.com/watch?v=6S5dEi0A35E', {
      extractAudio: true,
      audioFormat: 'm4a',
      format: 'worstaudio/bestaudio',
      output: 'test-client.m4a',
      noCheckCertificates: true,
      forceIpv4: true,
      extractorArgs: 'youtube:player_client=ios,web',
    });
    console.log('Success!');
  } catch (error) {
    console.error('Failed:', error.message);
  }
}

test();
