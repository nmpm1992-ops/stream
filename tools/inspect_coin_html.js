const fs = require('fs');

const file = process.argv[2] || 'coin_page.html';
const html = fs.readFileSync(file, 'utf8');

const re = /src="([^"]+\.js[^"]*)"/g;
const chunks = [];
let m;
while ((m = re.exec(html))) {
  const src = m[1];
  if (src.includes('/_next/static/chunks/')) chunks.push(src);
}

console.log(`file=${file}`);
console.log(`len=${html.length}`);
console.log(`chunks=${chunks.length}`);
console.log(chunks.slice(0, 20).join('\n'));

