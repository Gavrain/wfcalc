// 1) 武器赋能（Primary/Secondary/Mutation 等）在 ExportArcanes 里的覆盖情况
// 2) ExportUpgrades 与紫卡表 ZKMODS 的交叉覆盖
import { readFileSync } from 'node:fs';

const arcanes = JSON.parse(readFileSync('.cache/export/ExportArcanes.json', 'utf8'));
const upgrades = JSON.parse(readFileSync('.cache/export/upgrades.json', 'utf8'));
const zk = JSON.parse(readFileSync('.cache/inspect/zkmods.json', 'utf8'));
const zhDict = JSON.parse(readFileSync('.cache/export/langZh.json', 'utf8'));
const enDict = JSON.parse(readFileSync('.cache/export/langEn.json', 'utf8'));

const arcKeys = Object.keys(arcanes);
const gunArcanes = arcKeys.filter((k) => /Weapon|Primary|Secondary|Rifle|Shotgun|Pistol|Melee/i.test(k));
console.log('=== 疑似武器赋能 ===', gunArcanes.length);
for (const k of gunArcanes.slice(0, 12)) {
  const a = arcanes[k];
  console.log(`  ${enDict[a.name] ?? a.name}  [${k.split('/').pop()}] rarity=${a.rarity} levels=${a.levelStats?.length ?? 0}`);
}

// 取一个具体武器赋能，看数值是否可读
const sample = gunArcanes[0];
console.log('\n=== 样例结构 ===');
console.log(JSON.stringify(arcanes[sample], null, 1).slice(0, 1600));

// ---- 交叉覆盖 ----
const upByName = new Map();
for (const [key, u] of Object.entries(upgrades)) {
  if (u.name) upByName.set(u.name, { key, ...u });
}
console.log('\n=== ExportUpgrades ===', Object.keys(upgrades).length, '| 去重语言键', upByName.size);

let matched = 0;
const unmatched = [];
for (const m of zk) {
  // ZK 的英文名 → 找到对应 upgrades 条目的语言键（用英文显示名反查）
  const hits = Object.values(upgrades).filter((u) => enDict[u.name] === m.n);
  if (hits.length) matched++;
  else unmatched.push(m.n);
}
console.log(`ZK 模组 ${zk.length} 个，能在 ExportUpgrades 里按英文名找到的：${matched}`);
console.log('找不到的（前 30）:', unmatched.slice(0, 30).join(' / '));
console.log('找不到的共:', unmatched.length);
