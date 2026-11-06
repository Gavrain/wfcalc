// 把 ZK 的 WEAPON_DB 与官方武器导出做 id/名称匹配，评估可用覆盖率。
import { readFileSync } from 'node:fs';

const DB = JSON.parse(readFileSync('.cache/inspect/weapon-db.json', 'utf8'));
const W = JSON.parse(readFileSync('.cache/export/weapons.json', 'utf8'));
const en = JSON.parse(readFileSync('.cache/export/langEn.json', 'utf8'));

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

// 官方武器：id + 英文名
const offical = [];
for (const [key, w] of Object.entries(W)) {
  offical.push({ key, id: key.split('/').pop(), name: en[w.name] ?? w.name, w });
}

const byId = new Map(offical.map((o) => [norm(o.id), o]));
const byName = new Map(offical.map((o) => [norm(o.name), o]));

let hitId = 0, hitName = 0, miss = [];
const matched = [];
for (const d of DB) {
  const a = byId.get(norm(d.i));
  const b = a ?? byName.get(norm(d.n ?? ''));
  if (a) hitId++;
  if (b) {
    if (!a) hitName++;
    matched.push({ zk: d, off: b, via: a ? 'id' : 'name' });
  } else {
    miss.push(`${d.i} | ${d.n}`);
  }
}
console.log(`ZK 武器 ${DB.length} 把：按 id 命中 ${hitId}，按名称补 ${hitName}，未命中 ${miss.length}`);
console.log('未命中样例（前 40）:');
console.log(miss.slice(0, 40).join('\n'));

// 看看命中后类别的分布
const dist = {};
for (const m of matched) dist[`${m.zk.c} (${m.zk.s})`] = (dist[`${m.zk.c} (${m.zk.s})`] ?? 0) + 1;
console.log('\n命中武器按 ZK 类别分布:', JSON.stringify(dist));
