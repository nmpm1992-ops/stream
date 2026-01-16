const fs = require('fs');

const file = process.argv[2] || '_ref/chunk_chat.js';
const s = fs.readFileSync(file, 'utf8');

const needles = [
  'livechat',
  'livechat.pump.fun',
  'livestreams/stream/livechat-token',
  'livechat-token',
  'livechat-channel',
  'frontend-api-v3.pump.fun',
  'https://'
];

for (const n of needles) {
  const idx = s.indexOf(n);
  console.log(`${n}: idx=${idx}`);
  if (idx !== -1) {
    console.log(s.slice(Math.max(0, idx - 120), Math.min(s.length, idx + 400)));
    console.log('---');
  }
}

