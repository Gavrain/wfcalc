// 解码 WEAPON_DB（含 Infinity 字面量），看 c（枪械类）与 s（槽位）字典。
import { readFileSync, writeFileSync } from 'node:fs';

const lines = readFileSync('20261031紫卡模拟器V10.html', 'utf8').split(/\r?\n/);

function grabLiteral(prefix) {
  const line = lines.find((l) => l.trimStart().startsWith(prefix));
  if (!line) throw new Error('找不到 ' + prefix);
  const start = line.indexOf('=');
  const text = line.slice(start + 1).replace(/;\s*$/, '');
  return JSON.parse(text.replace(/\b-?Infinity\b/g, (m) => (m[0] === '-' ? '-1e308' : '1e308')));
}

const POOL = grabLiteral('var WEAPON_DB_POOL');
const ENC = grabLiteral('var WEAPON_DB_ENC');

function dec(o) {
  if (Array.isArray(o)) return o.map(dec);
  if (o && typeof o === 'object') return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, dec(v)]));
  if (typeof o === 'number' && o < 0 && Number.isInteger(o) && -o - 1 < POOL.length) return POOL[-o - 1];
  return o;
}

const DB = dec(ENC);
console.log('武器数:', DB.length);
console.log('全部字段:', JSON.stringify([...new Set(DB.flatMap((w) => Object.keys(w)))]));

const count = (fn) => {
  const a = {};
  for (const w of DB) {
    const v = fn(w);
    if (v === undefined || v === null) continue;
    a[v] = (a[v] ?? 0) + 1;
  }
  return a;
};
console.log('\n=== s（武器槽位） ===');
console.log(JSON.stringify(count((w) => w.s), null, 1));
console.log('\n=== c（枪械类） ===');
console.log(JSON.stringify(count((w) => w.c), null, 1));
console.log('\n=== 枪械类 × 槽位 ===');
const cross = {};
for (const w of DB) {
  const k = `${w.s} / ${w.c ?? '-'}`;
  cross[k] = (cross[k] ?? 0) + 1;
}
console.log(Object.entries(cross).sort().map(([k, v]) => `${String(v).padStart(4)} ${k}`).join('\n'));

writeFileSync('.cache/inspect/weapon-db.json', JSON.stringify(DB));
