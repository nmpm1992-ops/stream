const fs = require('fs');

const file = process.argv[2] || '_ref/chunk_chat.js';
const s = fs.readFileSync(file, 'utf8');

const re = /\.on\("([^"]+)"\s*,/g;
const set = new Set();
let m;
while ((m = re.exec(s))) {
  const ev = m[1];
  if (ev.length < 60) set.add(ev);
}

const filtered = Array.from(set)
  .filter((e) => /message|room|chat|pin|reaction|join|leave|history/i.test(e))
  .sort();

console.log(`file=${file}`);
console.log(`total=${set.size}`);
console.log(filtered.join('\n'));

