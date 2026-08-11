import axios from 'axios';

async function test() {
  try {
    const res = await axios.post('https://api.cobalt.tools/api/json', {
      url: 'https://www.youtube.com/watch?v=6S5dEi0A35E',
      isAudioOnly: true,
      aFormat: 'mp3'
    }, {
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      }
    });
    console.log('Cobalt URL:', res.data.url);
  } catch (err) {
    console.error('Cobalt Error:', err.response?.data || err.message);
  }
}

test();
