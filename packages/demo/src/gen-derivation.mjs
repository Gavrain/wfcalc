/**
 * 生成 `docs/数值推导.md` 里那张「变量逐级推导」表的原始数据。
 *   node packages/demo/src/gen-derivation.mjs
 *
 * 为什么要有这个脚本：文档里的每个中间变量都写明了"由哪几个输入算来"，
 * 一旦内核改了，重跑这个脚本就能看出文档哪些数字过期了——
 * 文档不该是手抄的快照。
 */
import { readFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripTemp } from './strip-to-temp.mjs';

const ROOT = normalize(join(fileURLToPath(new URL('.', import.meta.url)), '../../..'));
const { transpile } = await import(new URL('./transpile.mjs', import.meta.url).href);

const core = await stripTemp(ROOT, 'packages/core/src/index.ts', transpile);
const adapter = await stripTemp(ROOT, 'packages/data/src/adapter.ts', transpile);

const weapons = JSON.parse(await readFile(join(ROOT, 'packages/data/src/generated/weapons/primary.json'), 'utf8'));
const modsJson = JSON.parse(await readFile(join(ROOT, 'packages/data/src/generated/mods/mods.json'), 'utf8'));

const weapon = weapons.weapons.find((w) => w.id === 'KuvaKarak');
const mode = weapon.modes.find((m) => m.id === 'primary');

const BUILD = [
  ['serration', '膛线'],
  ['split_chamber', '分裂膛室'],
  ['point_strike', '致命一击'],
  ['vital_sense', '弱点感应'],
  ['hellfire', '地狱火'],
];

const contribs = [];
for (const [i, [id]] of BUILD.entries()) {
  const mod = modsJson.mods.find((m) => m.id === id);
  if (!mod) throw new Error(`找不到 Mod ${id}`);
  contribs.push(...adapter.modToContributions(mod, mod.maxRank, i));
}

const opts = { kuva: { type: 'heat', ratio: 0.5 }, faction: 'none', headshot: { enabled: false, multiplier: 3 } };
const res = core.compute(weapon, mode, contribs, opts);
const seg = res.segments[0];
const ps = core.panelStats(weapon, mode);

const r = (n, d = 4) => (typeof n === 'number' ? Number(n.toFixed(d)) : n);
const spreadStr = (s) =>
  Object.entries(s)
    .filter(([, v]) => typeof v === 'number' && Math.abs(v) > 1e-9)
    .map(([k, v]) => `${k} ${r(v)}`)
    .join(' + ');

const out = {
  weapon: { id: weapon.id, name: weapon.name, nameZh: weapon.nameZh, category: weapon.category },
  mode: { id: mode.id, role: mode.role, trigger: mode.trigger, bullets: mode.bullets, multishot: mode.multishot },

  // L0 面板
  L0_panel: { spread: seg.panel, total: r(core.spreadTotal(seg.panel)) },

  // L1 玄骸
  L1_kuva: { ratio: 0.5, type: 'heat', spread: seg.panelWithKuva, total: r(core.spreadTotal(seg.panelWithKuva)) },

  // L2 基伤 / 多重
  L2_baseDamage: {
    pct_baseDamage: core.sumPct(contribs, 'baseDamage'),
    factor: r(1 + core.sumPct(contribs, 'baseDamage')),
    spread: seg.baseAfterBaseDamage,
    total: r(core.spreadTotal(seg.baseAfterBaseDamage)),
  },
  L2_multishot: { pct: core.sumPct(contribs, 'multishot'), value: r(core.multishot(contribs)) },

  // L3 元素
  L3_elements: {
    pct_heat: core.sumPct(contribs, 'elemental:heat'),
    slots: seg.elementDetail.slots.map((s) => ({ type: s.type, amount: r(s.amount), order: s.order, source: s.source })),
    compounds: seg.elementDetail.compounds.map((c) => ({ type: c.type, amount: r(c.amount) })),
    singles: seg.elementDetail.singles.map((c) => ({ type: c.type, amount: r(c.amount) })),
    finalHit: seg.finalHit,
    finalTotal: r(core.spreadTotal(seg.finalHit)),
  },

  // L4 暴击 + 爆头
  L4_crit: {
    critChance: r(seg.critChance),
    critDamage: r(seg.critDamage),
    tiers: core.critTiers(seg.critChance, seg.critDamage).map((t) => ({ k: t.k, prob: r(t.prob), mul: r(t.mul) })),
    line: { nonCrit: r(seg.line.nonCrit), crit: r(seg.line.crit), average: r(seg.line.average) },
    expectedHitMultiplier_noHeadshot: r(core.expectedHitMultiplier(seg.critChance, seg.critDamage, false, 3)),
  },

  // DoT 基础值
  dotBase: { spread: seg.dotBase, total: r(core.spreadTotal(seg.dotBase)) },
  dotTicks: seg.dotTicks.map((t) => ({
    type: t.type,
    baseValue: r(t.baseValue),
    coef: core.DOT_COEF[t.type],
    baseTick: r(t.baseTick),
    elementPct: r(t.elementPct),
    statusDamagePct: r(t.statusDamagePct),
    factionPct: r(t.factionPct),
    tick: r(t.tick),
  })),

  // L6 输出口径
  output: {
    lines: res.output.lines.map((l) => ({ id: l.id, label: l.label, value: r(l.value), unit: l.unit })),
    multishot: r(res.output.multishot),
    fireRate: r(res.output.fireRate),
    dotPerType: res.output.dotPerType,
    stacksPerType: Object.fromEntries(Object.entries(res.output.stacksPerType).map(([k, v]) => [k, r(v)])),
  },

  // 面板对照（demo 左侧表格）
  panelPairs: Object.fromEntries(
    Object.entries(res.panelPairs).map(([k, v]) => [k, { base: r(v.base), after: r(v.after) }]),
  ),

  // 乘区拆解
  buckets: core.bucketBreakdown(weapon, contribs, mode).map((b) => ({
    stat: b.stat,
    panel: r(b.panel),
    pct: r(b.pct, 6),
    flat: r(b.flat),
    mul: r(b.mul),
    value: r(b.value),
    contributors: b.contributors.map((c) => `${c.source}:${c.form}:${c.amount}`),
  })),

  // 备选区增幅（演示 3 张卡）
  gains: (() => {
    const candidates = ['heavy_caliber', 'primed_cryo_rounds', 'ammo_stock'].map((id) => {
      const m = modsJson.mods.find((x) => x.id === id);
      return m ? [id, adapter.modToContributions(m, m.maxRank, 5)] : null;
    });
    return candidates
      .filter(Boolean)
      .map(([id, c]) => ({
        mod: id,
        gain_perShot: core.gainsFor(weapon, mode, contribs, [c], [], 'perShot', opts, false)[0],
        gain_sustained: core.gainsFor(weapon, mode, contribs, [c], [], 'sustainedDps', opts, false)[0],
      }));
  })(),

  // 关键中间值
  spreadTotalFinalHit: r(core.spreadTotal(seg.finalHit)),
  moddedPanelTotal: r(res.moddedPanelTotal),
  offsets: { spreadStrPanel: spreadStr(seg.panel), spreadStrFinal: spreadStr(seg.finalHit) },
};

console.log(JSON.stringify(out, null, 2));
