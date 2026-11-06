// 检查产出文件的形状与内容质量。
import { readFileSync } from 'node:fs';

const mods = JSON.parse(readFileSync('packages/data/src/generated/mods/mods.json', 'utf8'));
const slots = JSON.parse(readFileSync('packages/data/src/generated/mods/weapon-slots.json', 'utf8'));

console.log('mods count:', mods.count, '| weapons:', slots.count);

const m = mods.mods.find((x) => x.id === 'serration');
console.log('\n=== Serration ===');
console.log(JSON.stringify(m, null, 1));

const gp = mods.mods.find((x) => x.id === 'galvanized_chamber');
console.log('\n=== Galvanized Chamber（条件类） ===');
console.log(JSON.stringify({ id: gp.id, maxRank: gp.maxRank, stats: gp.stats, conditions: gp.conditions, conflictsWith: gp.conflictsWith }, null, 1));

console.log('\n=== 装备槽位样例 ===');
for (const id of ['Dread', 'Strun', 'Skana', 'KuvaBramma', 'Sirocco']) {
  const w = slots.weapons[id];
  if (w) console.log(`  ${w.name} (${w.nameZh}) → ${JSON.stringify(w.modKinds)} [${w.slots.source}]${w.slots.specific.length ? ' specific=' + w.slots.specific : ''}`);
}

// 质量检查
const bad = mods.mods.filter((x) => x.stats.length === 0);
console.log(`\n没有属性数值的 Mod：${bad.length}（应为 0）`);
const weird = mods.mods.filter((x) => x.stats.some((s) => s.levelValues.some((v) => !Number.isFinite(v))));
console.log(`数值含 NaN/Infinity 的 Mod：${weird.length}（应为 0）`);
const noZh = mods.mods.filter((x) => !x.name.zh);
console.log(`缺中文名：${noZh.length}（应为 0）`);
const withCond = mods.mods.filter((x) => x.conditions.length > 0);
console.log(`带条件效果的 Mod：${withCond.length}`);
const exclusive = mods.mods.filter((x) => x.exclusiveGroup);
console.log(`有互斥族的 Mod：${exclusive.length}`);
