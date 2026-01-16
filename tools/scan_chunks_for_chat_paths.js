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

const pathRe = /chat\/[a-zA-Z0-9_\-\/\$\{\}]+/g;
const found = new Set();

async function main() {
  for (const src of chunkSrcs) {
    const url = src.startsWith('http') ? src : `https://pump.fun${src}`;
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const text = await res.text();
      let mm;
      while ((mm = pathRe.exec(text))) {
        const v = mm[0];
        if (v.length <= 120) found.add(v);
      }
    } catch {
      // ignore
    }
  }

  console.log(`file=${file}`);
  console.log(`chunks=${chunkSrcs.length}`);
  console.log(`chatPaths=${found.size}`);
  console.log(Array.from(found).sort().join('\n'));
}

main();

