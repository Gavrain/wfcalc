/**
 * 导出「变量依赖图」的数据：直接读 `compute().state`，**不再自己重算**。
 *   node packages/demo/src/gen-graph.mjs <weaponId> [--kuva <elem>] [--mods a,b,c]
 *
 * 依赖的 state 结构见 `packages/core/src/weapon-state.ts`：
 *   state.inputs   = 面板 + 各属性 %Mod / 绝对值 / 乘算（数组）
 *   state.computed = 当前<属性> / 新面板 / 基伤面板 / 元素槽位 / 命中分布
 */
import { readFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripTemp } from './strip-to-temp.mjs';

const ROOT = normalize(join(fileURLToPath(new URL('.', import.meta.url)), '../../..'));
const { transpile } = await import(new URL('./transpile.mjs', import.meta.url).href);
const core = await stripTemp(ROOT, 'packages/core/src/index.ts', transpile);
const adapter = await stripTemp(ROOT, 'packages/data/src/adapter.ts', transpile);

const argv = process.argv.slice(2);
const weaponId = argv.find((a) => !a.startsWith('--') && argv[argv.indexOf(a) - 1] !== '--kuva' && argv[argv.indexOf(a) - 1] !== '--mods') ?? 'KuvaKarak';
const kuvaElem = argv.includes('--kuva') ? argv[argv.indexOf('--kuva') + 1] : null;
const modArg = argv.includes('--mods') ? argv[argv.indexOf('--mods') + 1] : 'serration,split_chamber,point_strike,vital_sense,hellfire';

const cats = ['primary', 'secondary', 'melee', 'archgun', 'archmelee', 'companion', 'unknown'];
let weapon = null;
for (const c of cats) {
  try {
    const data = JSON.parse(await readFile(join(ROOT, `packages/data/src/generated/weapons/${c}.json`), 'utf8'));
    weapon = data.weapons.find((w) => w.id === weaponId);
  } catch { /* skip */ }
  if (weapon) break;
}
if (!weapon) throw new Error(`找不到武器 ${weaponId}`);

const modsJson = JSON.parse(await readFile(join(ROOT, 'packages/data/src/generated/mods/mods.json'), 'utf8'));
const modIds = modArg ? modArg.split(',').map((s) => s.trim()).filter(Boolean) : [];
const contribs = [];
for (const [i, id] of modIds.entries()) {
  const m = modsJson.mods.find((x) => x.id === id);
  if (!m) throw new Error(`找不到 Mod ${id}`);
  contribs.push(...adapter.modToContributions(m, m.maxRank, i));
}

const opts = {
  kuva: kuvaElem ? { type: kuvaElem, ratio: 0.6 } : undefined,
  faction: 'none',
  headshot: { enabled: false, multiplier: 3 },
};

const mode = weapon.modes[0];
const res = core.compute(weapon, mode, contribs, opts, false);
const st = res.state;
const r = (n, d = 4) => (typeof n === 'number' ? Number(n.toFixed(d)) : n);
const sp = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => Math.abs(v) > 1e-9).map(([k, v]) => [k, r(v)]));
const listOf = (arr) => arr.map((x) => ({ src: x.src, amount: r(x.amount) }));

const graph = {
  weapon: { id: weapon.id, name: weapon.nameZh ?? weapon.name, category: weapon.category, variant: weapon.variant ?? null },
  mode: { id: mode.id, role: mode.role, trigger: mode.trigger },

  // ═══ 输入层：不可再分 ═══
  inputs: {
    'w.面板.伤害分布': sp(st.inputs.panel.damage),
    'w.面板.暴击率': r(st.inputs.panel.critChance),
    'w.面板.暴击伤害': r(st.inputs.panel.critMultiplier),
    'w.面板.触发率': r(st.inputs.panel.statusChance),
    'w.面板.射速': r(st.inputs.panel.fireRate),
    'w.面板.弹匣': r(st.inputs.panel.magazineSize),
    'w.面板.装填时间': r(st.inputs.panel.reloadTime),
    'w.面板.多重': r(st.inputs.panel.multishot),
    'w.玄骸加成': { element: st.inputs.kuva.type, ratio: st.inputs.kuva.ratio },
    'w.暴击率%Mod': listOf(st.inputs.pct.critChance),
    'w.暴击率绝对加成': listOf(st.inputs.flat.critChance),
    'w.暴击伤害%Mod': listOf(st.inputs.pct.critMultiplier),
    'w.暴击伤害绝对加成': listOf(st.inputs.flat.critMultiplier),
    'w.基伤%Mod': listOf(st.inputs.pct.baseDamage),
    'w.多重%Mod': listOf(st.inputs.pct.multishot),
    'w.触发率%Mod': listOf(st.inputs.pct.statusChance),
    'w.射速%Mod': listOf(st.inputs.pct.fireRate),
    'w.元素%Mod': st.inputs.elemental.map((x) => ({ stat: x.stat, src: x.src, amount: r(x.amount) })),
    'w.物理%Mod': st.inputs.physical.map((x) => ({ stat: x.stat, src: x.src, amount: r(x.amount) })),
  },

  // ═══ computed 层：直接从 state 取，不重算 ═══
  computed: [
    { id: 'w.当前暴击率', value: r(st.computed.当前暴击率), formula: '(面板暴击率 × (1+Σ暴击率%Mod) + Σ绝对加成)', deps: ['w.面板.暴击率', 'w.暴击率%Mod', 'w.暴击率绝对加成'] },
    { id: 'w.当前暴击伤害', value: r(st.computed.当前暴击伤害), formula: '(面板暴击伤害 × (1+Σ暴伤%Mod) + Σ绝对加成)', deps: ['w.面板.暴击伤害', 'w.暴击伤害%Mod', 'w.暴击伤害绝对加成'] },
    { id: 'w.当前触发率', value: r(st.computed.当前触发率), formula: '面板触发率 × (1+Σ触发率%Mod)', deps: ['w.面板.触发率', 'w.触发率%Mod'] },
    { id: 'w.当前射速', value: r(st.computed.当前射速), formula: '面板射速 × (1+Σ射速%Mod)', deps: ['w.面板.射速', 'w.射速%Mod'] },
    { id: 'w.当前多重', value: r(st.computed.当前多重), formula: '面板多重 × (1+Σ多重%Mod) + Σ绝对值', deps: ['w.面板.多重', 'w.多重%Mod'] },
    { id: 'w.当前弹匣', value: r(st.computed.当前弹匣), formula: '面板弹匣 × (1+Σ弹匣%Mod)', deps: ['w.面板.弹匣'] },
    { id: 'w.当前装填时间', value: r(st.computed.当前装填时间), formula: '面板装填时间 ÷ (1+Σ装填速度%)', deps: ['w.面板.装填时间'] },
    { id: 'w.新面板', value: sp(st.computed.新面板), total: r(st.computed.新面板总伤), formula: '面板.伤害分布 + {玄骸元素: 面板总伤 × 比例}', deps: ['w.面板.伤害分布', 'w.玄骸加成'] },
    { id: 'w.基伤面板', value: sp(st.computed.基伤面板), total: r(st.computed.基伤面板总伤), formula: '新面板.每一型 × (1+Σ基伤%Mod)', deps: ['w.新面板', 'w.基伤%Mod'] },
    { id: 'w.元素槽位', value: st.computed.元素槽位.map((s) => ({ type: s.type, order: s.order, source: s.source, amount: r(s.amount) })), formula: '各元素独立成槽（Mod 序 0~7、自带 序 9~12），合成前不合并', deps: ['w.基伤面板', 'w.元素%Mod', 'w.物理%Mod'] },
    { id: 'w.命中分布', value: sp(st.computed.命中分布), total: r(st.computed.命中分布总伤), formula: '元素槽位两两合成 → 复合/单元素', deps: ['w.元素槽位'] },
  ],

  // 面板对照（demo 左侧）
  panelPairs: Object.fromEntries(Object.entries(res.panelPairs).map(([k, v]) => [k, { base: r(v.base), after: r(v.after) }])),

  // 输出口径
  output: res.output.lines.map((l) => ({ id: l.id, label: l.label, value: r(l.value), unit: l.unit })),

  // 乘区拆解（每个都能复算）
  buckets: st.buckets.map((b) => ({ stat: b.stat, panel: r(b.panel), pct: r(b.pct, 6), flat: r(b.flat), mul: r(b.mul), value: r(b.value), by: b.contributors.map((x) => `${x.source}:${x.form}:${x.amount}`) })),
};

console.log(JSON.stringify(graph, null, 2));
