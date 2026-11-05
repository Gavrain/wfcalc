// 核对赋能与套装产出的形状与内容质量。
import { readFileSync } from 'node:fs';

const arcs = JSON.parse(readFileSync('packages/data/src/generated/mods/arcanes.json', 'utf8'));
const sets = JSON.parse(readFileSync('packages/data/src/generated/mods/mod-sets.json', 'utf8'));

console.log('赋能:', arcs.count, '| 剔除:', arcs.skipped.length, '| 套装:', sets.count);

// 分类分布
const byCat = {};
const byKind = {};
for (const a of arcs.arcanes) {
  byCat[a.category] = (byCat[a.category] ?? 0) + 1;
  byKind[a.effectKind] = (byKind[a.effectKind] ?? 0) + 1;
}
console.log('\n类别:', JSON.stringify(byCat));
console.log('作用:', JSON.stringify(byKind));

console.log('\n=== 样例：主要·无情 ===');
const m = arcs.arcanes.find((a) => a.id === 'PrimaryDamageOnKill');
console.log(JSON.stringify(m, null, 1).slice(0, 1200));

console.log('\n=== 套装：私法 / 角斗士 ===');
for (const id of ['Vigilante', 'Gladiator']) {
  const s = sets.sets.find((x) => x.id === id);
  console.log(JSON.stringify({ id: s.id, name: s.name, effect: s.effect, description: s.description, levels: s.levels }, null, 1));
}

// 质量检查
const bad = arcs.arcanes.filter((a) => a.levels.length === 0);
console.log(`\n无等级数据的赋能: ${bad.length}（应为 0）`);
const noEnv = arcs.arcanes.filter((a) => Object.keys(a.levels.at(-1).values).length === 0);
console.log(`满级无任何数值槽的赋能: ${noEnv.length}`);
if (noEnv.length) console.log('  ', noEnv.map((a) => `${a.name.zh}(${a.id})`).join(', '));
const special = arcs.arcanes.filter((a) => a.effectKind === 'special');
console.log(`需人工确认乘区的赋能: ${special.length}`);
