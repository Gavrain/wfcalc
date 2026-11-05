// 打印未登记属性键的上下文（所在模组、描述），便于逐条判断。
import { readFileSync } from 'node:fs';
import { lookupStat } from '../../packages/data-build/src/mods/stat-map.ts';

const M = JSON.parse(readFileSync('.cache/inspect/zkmods.json', 'utf8'));
const mods = M.filter((m) => m.s === 'g' || m.s === 'm');

const byKey = new Map();
for (const m of mods) {
  for (const p of m.p ?? []) {
    if (lookupStat(p[0]) !== undefined) continue;
    if (!byKey.has(p[0])) byKey.set(p[0], []);
    byKey.get(p[0]).push({ id: m.i, name: m.n, zh: m.z, slot: m.t, val: p[1], extra: p[2], de: m.de });
  }
}

for (const [k, list] of [...byKey].sort()) {
  console.log(`\n### ${k}  (${list.length})`);
  for (const m of list) {
    console.log(`  - ${m.id} [${m.slot}] ${m.zh} / ${m.name} = ${m.val}${m.extra !== undefined ? ' +' + m.extra : ''}`);
    console.log(`    ${m.de}`);
  }
}
