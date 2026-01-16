const fs = require('fs');

const file = process.argv[2] || 'coin_page.html';
const html = fs.readFileSync(file, 'utf8');

const patterns = [
  'livechat.pump.fun',
  'socket.io',
  '/rooms/',
  'config/chat',
  'join_room',
  'chat_message',
  '/messages',
  'messages',
  'chat/messages',
  'chat/rooms',
  'livestreams/stream/livechat-token',
  'livechat-token',
  'livechat-channel',
  'livestream-api.pump.fun'
];

const srcRe = /src="([^"]+\.js[^"]*)"/g;
const chunkSrcs = [];
let m;
while ((m = srcRe.exec(html))) {
  const src = m[1];
  if (src.includes('/_next/static/chunks/')) chunkSrcs.push(src);
}

async function main() {
  console.log(`file=${file}`);
  console.log(`chunks=${chunkSrcs.length}`);

  for (let i = 0; i < chunkSrcs.length; i++) {
    const src = chunkSrcs[i];
    const url = src.startsWith('http') ? src : `https://pump.fun${src}`;
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const text = await res.text();
      const hits = patterns.filter((p) => text.includes(p));
      // Skip generic socket.io runtime chunk hits (not Pump.fun specific)
      const meaningfulHits = hits.filter((h) => h !== 'socket.io');
      if (meaningfulHits.length) {
        console.log(`\n[HIT] chunk=${i + 1}/${chunkSrcs.length}`);
        console.log(`url=${url}`);
        console.log(`hits=${meaningfulHits.join(', ')}`);

        // Print small surrounding snippets for each hit (first occurrence only)
        for (const p of meaningfulHits) {
          const idx = text.indexOf(p);
          const start = Math.max(0, idx - 120);
          const end = Math.min(text.length, idx + p.length + 200);
          console.log(`--- snippet for ${p} ---`);
          console.log(text.slice(start, end));
        }

        // Stop only when we likely found chat message endpoints or livechat auth flow
        const stopSignals = ['config/chat', 'join_room', 'chat_message', 'chat/rooms', 'chat/messages', 'livechat-token', 'livechat-channel', 'livechat.pump.fun'];
        if (meaningfulHits.some((h) => stopSignals.includes(h))) return;
      }
    } catch (e) {
      // ignore fetch errors; continue
    }
  }

  console.log('No hits found in any chunk.');
}

main();

