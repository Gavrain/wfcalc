// 剖析 ZKMODS 的结构：字段、模组类型、可影响的属性键（p[][0]）等。
import { readFileSync } from 'node:fs';

const M = JSON.parse(readFileSync('.cache/inspect/zkmods.json', 'utf8'));
console.log('mods:', M.length);

const count = (fn) => {
  const acc = {};
  for (const m of M) {
    const v = fn(m);
    if (v == null) continue;
    acc[v] = (acc[v] ?? 0) + 1;
  }
  return acc;
};

const fields = {};
for (const m of M) for (const k of Object.keys(m)) fields[k] = (fields[k] ?? 0) + 1;
console.log('\n=== 字段出现次数 ===');
console.log(JSON.stringify(fields, null, 1));

console.log('\n=== t（模组槽位类型） ===');
console.log(JSON.stringify(count((m) => m.t), null, 1));

console.log('\n=== s（类型细分） ===');
console.log(JSON.stringify(count((m) => m.s), null, 1));

console.log('\n=== r（稀有度） ===');
console.log(JSON.stringify(count((m) => m.r), null, 1));

console.log('\n=== y（极性） ===');
console.log(JSON.stringify(count((m) => m.y), null, 1));

console.log('\n=== p[][0]（属性键） ===');
const stat = {};
for (const m of M) for (const [k] of m.p ?? []) stat[k] = (stat[k] ?? 0) + 1;
console.log(JSON.stringify(stat, null, 1));

console.log('\n=== p 条目长度分布 ===');
console.log(JSON.stringify(count((m) => (m.p ?? []).length)));

console.log('\n=== p 条目第二项是否非数字 ===');
const odd = M.flatMap((m) => (m.p ?? []).filter((p) => typeof p[1] !== 'number').map((p) => [m.i, p]));
console.log(JSON.stringify(odd.slice(0, 20)), 'count=', odd.length);
