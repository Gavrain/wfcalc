/**
 * 计算链条快照：把一把武器从「基础面板」到「最终输出」的每一步中间值全部导出。
 *   node packages/demo/src/gen-chain.mjs <weaponId> [--kuva <elem>] [--mods a,b,c]
 *
 * 用途：`docs/计算链条.md` 的表格数据来源；也是排查"某个数字怎么来的"的入口。
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
const weaponId = argv[0] ?? 'KuvaKarak';
const kuvaElem = argv.includes('--kuva') ? argv[argv.indexOf('--kuva') + 1] : null;
const modArg = argv.includes('--mods') ? argv[argv.indexOf('--mods') + 1] : 'serration,split_chamber,point_strike,vital_sense,hellfire';

const cats = ['primary', 'secondary', 'melee', 'archgun', 'archmelee', 'companion', 'unknown'];
let weapon = null;
for (const c of cats) {
  try {
    const data = JSON.parse(await readFile(join(ROOT, `packages/data/src/generated/weapons/${c}.json`), 'utf8'));
    weapon = data.weapons.find((w) => w.id === weaponId);
  } catch { /* 缺文件跳过 */ }
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

const mode = weapon.modes[0];
const kuvaRatio = 0.6;
const opts = {
  kuva: kuvaElem ? { type: kuvaElem, ratio: kuvaRatio } : undefined,
  faction: 'none',
  headshot: { enabled: false, multiplier: 3 },
};

const r = (n, d = 4) => (typeof n === 'number' ? Number(n.toFixed(d)) : n);
const entry = (obj) => Object.entries(obj)
  .filter(([, v]) => typeof v === 'number' && Math.abs(v) > 1e-9)
  .map(([k, v]) => [k, r(v)]);

// D-080：段在变体内；这里取第一个变体的第一段作为"当前面板"
const seg = core.firstSegment(mode);
const panel = { ...seg.damage };
const panelTotal = core.spreadTotal(panel);

// 手动跑一遍链，拿到每一步（compute 只给最终值）
const panelWithKuva = core.applyKuvaBonus(panel, opts.kuva);
const baseAfterBaseDamage = core.applyBaseDamage(panelWithKuva, seg, contribs, 0, 0);
const elements = core.applyElements(baseAfterBaseDamage, contribs, 'hit');

const res = core.compute(weapon, mode, contribs, opts, false);
const s2 = res.segments[0];

const out = {
  weapon: { id: weapon.id, name: weapon.name, nameZh: weapon.nameZh, category: weapon.category, variant: weapon.variant ?? null },
  mode: { id: mode.id, role: mode.role, trigger: mode.trigger, multishot: mode.multishot, bullets: mode.bullets, segments: core.segmentCount(mode) },
  mods: modIds,

  // ── 第 1 步：基础面板 ──
  step1_basicPanel: {
    damage: entry(panel),
    total: r(panelTotal),
    critChance: r(mode.override?.critChance ?? weapon.critChance),
    critMultiplier: r(mode.override?.critMultiplier ?? weapon.critMultiplier),
    statusChance: r(mode.override?.statusChance ?? weapon.statusChance),
    fireRate: r(mode.override?.fireRate ?? weapon.fireRate),
    magazineSize: r(mode.override?.magazineSize ?? weapon.magazineSize ?? 0),
    reloadTime: r(mode.override?.reloadTime ?? weapon.reloadTime ?? 0),
    multishot: r(core.multishot([]) * (mode.override ? 1 : 1) * mode.multishot),
  },

  // ── 第 2 步：玄骸加成（所有武器都走，非玄骸 amount=0）──
  step2_kuva: {
    active: Boolean(opts.kuva),
    element: opts.kuva?.type ?? null,
    ratio: opts.kuva?.ratio ?? 0,
    amount: r(panelTotal * (opts.kuva?.ratio ?? 0)),
    panelBefore: entry(panel),
    panelAfter: entry(panelWithKuva),
    totalBefore: r(panelTotal),
    totalAfter: r(core.spreadTotal(panelWithKuva)),
  },

  // ── 第 3 步：基伤 + 多重 ──
  step3_baseAndMultishot: {
    baseDamagePct: r(core.sumPct(contribs, 'baseDamage') * 100),
    baseDamageFactor: r(1 + core.sumPct(contribs, 'baseDamage')),
    afterBaseDamage: entry(baseAfterBaseDamage),
    totalAfterBaseDamage: r(core.spreadTotal(baseAfterBaseDamage)),
    multishotPct: r(core.sumPct(contribs, 'multishot') * 100),
    multishotValue: r(core.multishot(contribs)),
  },

  // ── 第 4 步：元素/物理加量 + 合成 ──
  step4_elements: {
    elementBase: r(core.spreadTotal(baseAfterBaseDamage)),
    slots: elements.slots.map((x) => ({
      type: x.type, order: x.order, source: x.source, amount: r(x.amount),
    })),
    compounds: elements.compounds.map((x) => ({ type: x.type, amount: r(x.amount) })),
    singles: elements.singles.map((x) => ({ type: x.type, amount: r(x.amount) })),
    finalHit: entry(elements.v),
    finalTotal: r(core.spreadTotal(elements.v)),
  },

  // ── 第 5 步：暴击 ──
  step5_crit: {
    critChance: r(s2.critChance),
    critDamage: r(s2.critDamage),
    tiers: core.critTiers(s2.critChance, s2.critDamage).map((t) => ({ k: t.k, prob: r(t.prob), mul: r(t.mul) })),
    nonCrit: r(s2.line.nonCrit),
    crit: r(s2.line.crit),
    average: r(s2.line.average),
    expectedMul: r(core.expectedHitMultiplier(s2.critChance, s2.critDamage, false, 3)),
  },

  // ── 第 6 步：DoT ──
  step6_dot: {
    dotBase: entry(s2.dotBase),
    dotBaseTotal: r(core.spreadTotal(s2.dotBase)),
    ticks: s2.dotTicks.map((t) => ({ type: t.type, baseValue: r(t.baseValue), coef: t.coef, baseTick: r(t.baseTick), tick: r(t.tick) })),
  },

  // ── 第 7 步：输出 ──
  step7_output: res.output.lines.map((l) => ({ id: l.id, label: l.label, value: r(l.value), unit: l.unit })),

  panelPairs: Object.fromEntries(Object.entries(res.panelPairs).map(([k, v]) => [k, { base: r(v.base), after: r(v.after) }])),
  buckets: core.bucketBreakdown(weapon, contribs, mode).map((b) => ({
    stat: b.stat, panel: r(b.panel), pct: r(b.pct, 6), flat: r(b.flat), mul: r(b.mul), value: r(b.value),
    by: b.contributors.map((c) => `${c.source}:${c.form}:${c.amount}`),
  })),
};

console.log(JSON.stringify(out, null, 2));
