'use strict';
/**
 * 数据体检：用脚本把"数据上的空洞"找出来，不靠人工翻。
 *
 * 检查项：
 *   1. 每种槽位大类（rifle / shotgun / …）能装多少 Mod
 *   2. 每把武器能装多少 Mod（为 0 的武器 = 一把枪什么都装不了）
 *   3. 每把武器能装几个赋能
 *   4. 玄骸 / 信条武器的元素表是否完整
 *   5. Mod 里 socketKind 没有对应武器类型的（写错了？）
 */
const fs = require('fs');
const ROOT = 'packages/data/src/generated';

const readJSON = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const slotFile = readJSON(`${ROOT}/mods/weapon-slots.json`);
const modFile = readJSON(`${ROOT}/mods/mods.json`);
const arcFile = readJSON(`${ROOT}/mods/arcanes.json`);
const arcanes = Array.isArray(arcFile) ? arcFile : arcFile.arcanes;

const WFILES = ['primary', 'secondary', 'melee', 'archgun', 'archmelee'];
const weapons = [];
for (const f of WFILES) {
  const raw = readJSON(`${ROOT}/weapons/${f}.json`);
  weapons.push(...(Array.isArray(raw) ? raw : raw.weapons));
}

const mods = modFile.mods;
const slotEntryOf = (id) => slotFile.weapons[id] || {};
const broadOf = (id) => {
  const e = slotEntryOf(id);
  return (e.slots && e.slots.broad) || null;
};

console.log('=== 总量');
console.log(`  武器 ${weapons.length} 把 · Mod ${mods.length} 张 · 赋能 ${arcanes.length} 个`);

// ── 1. 槽位大类覆盖 ──
console.log('\n=== 各槽位大类的 Mod 数');
const byKind = new Map();
for (const m of mods) byKind.set(m.slotKind, (byKind.get(m.slotKind) || 0) + 1);
const kindsUsed = new Map();
for (const w of weapons) {
  const b = broadOf(w.id);
  if (b) kindsUsed.set(b, (kindsUsed.get(b) || 0) + 1);
}
for (const [kind, n] of [...byKind.entries()].sort((a, b) => b[1] - a[1])) {
  const wcount = kindsUsed.get(kind);
  console.log(`  ${String(kind).padEnd(12)} ${String(n).padStart(4)} 张` + (wcount ? `  (${wcount} 把武器)` : '  ⚠ 没有武器用这个种类'));
}

// ── 2. 一把 Mod 都装不了的武器 ──
console.log('\n=== 装不了任何 Mod 的武器');
const kindsSet = new Set([...byKind.keys()]);
let zeroMod = 0;
for (const w of weapons) {
  const e = slotEntryOf(w.id);
  const kinds = (e.modKinds && e.modKinds.length) ? e.modKinds : [broadOf(w.id)].filter(Boolean);
  if (!kinds.some((k) => kindsSet.has(k))) {
    zeroMod++;
    console.log(`  ${w.id}  (broad=${broadOf(w.id)}, kinds=${JSON.stringify(kinds)})`);
  }
}
if (!zeroMod) console.log('  （无）');

// ── 3. 赋能覆盖 ──
console.log('\n=== 各赋能大类');
const byArc = new Map();
for (const a of arcanes) byArc.set(a.category, (byArc.get(a.category) || 0) + 1);
for (const [c, n] of [...byArc.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(c).padEnd(12)} ${String(n).padStart(3)} 个`);
}

// ── 4. 玄骸 / 信条元素表 ──
console.log('\n=== 玄骸 / 信条武器的元素表');
const kuva = weapons.filter((w) => w.kuva);
console.log(`  玄骸类 ${kuva.length} 把`);
const badKuva = kuva.filter((w) => !w.kuva.elements || !w.kuva.elements.length);
if (badKuva.length) badKuva.forEach((w) => console.log(`  ⚠ ${w.id} 缺元素表`));
else console.log('  ✔ 元素表都齐全');
const ranges = new Set(kuva.map((w) => JSON.stringify(w.kuva.bonusRange)));
console.log(`  加成范围取值: ${[...ranges].join(' / ')}`);

// ── 5. 有槽位种类但没武器的 ──
console.log('\n=== 没有武器使用的槽位种类');
const unused = [...byKind.keys()].filter((k) => !kindsUsed.has(k));
console.log(unused.length ? '  ⚠ ' + unused.join(', ') : '  ✔ 无');

// ── 6. 武器没有 modes 的 ──
console.log('\n=== 没有伤害模式（modes）的武器');
const noMode = weapons.filter((w) => !w.modes || !w.modes.length);
console.log(noMode.length ? noMode.slice(0, 10).map((w) => '  ' + w.id).join('\n') + (noMode.length > 10 ? `\n  …共 ${noMode.length} 把` : '') : '  ✔ 无');
