const fs = require('fs');

const file = process.argv[2] || 'coin_page.html';
const html = fs.readFileSync(file, 'utf8');

const srcRe = /src="([^"]+\.js[^"]*)"/g;
const chunkSrcs = [];
let m;
while ((m = srcRe.exec(html))) {
  const src = m[1];
  if (src.includes('/_next/static/chunks/')) chunkSrcs.push(src);
}

const needles = [
  'join_room',
  'joinRoom',
  'join-room',
  'chat_message',
  'new_message',
  'send_message',
  'sendMessage',
  'message_created',
  'room_message'
];

async function main() {
  for (const src of chunkSrcs) {
    const url = src.startsWith('http') ? src : `https://pump.fun${src}`;
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const text = await res.text();
      const hits = needles.filter((n) => text.includes(n));
      if (hits.length) {
        console.log(`\nurl=${url}`);
        console.log(`hits=${hits.join(', ')}`);
        for (const h of hits) {
          const idx = text.indexOf(h);
          console.log(`--- ${h} ---`);
          console.log(text.slice(Math.max(0, idx - 120), Math.min(text.length, idx + h.length + 220)));
        }
      }
    } catch {
      // ignore
    }
  }
}

main();

