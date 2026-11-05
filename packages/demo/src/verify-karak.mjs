/**
 * 赤毒·卡拉克验证：与人工手算对账，确认整条结算链算的是"对的数"。
 *   node packages/demo/src/verify-karak.mjs
 *
 * 手算（膛线 + 分裂膛室 + 致命一击 + 弱点感应；玄骸火焰 50%；无派系、不爆头）：
 *
 *   面板 = 7.13 冲 + 6.21 穿 + 9.66 切                    = 23.00
 *   玄骸（D-017：在基伤之前） 23 × 50%                     = 11.50
 *   基伤 ×(1+165%) = ×2.65    (23 + 11.5) × 2.65           = 91.425
 *   元素%：火 +90% → 91.425 × 0.9 = 82.2825（火是唯一元素，无配对）
 *   加成后总伤 = 91.425 + 82.2825                          = 173.7075
 *   暴率 = 0.23 × (1+150%)                                 = 57.5%
 *   总爆伤 = 2.1 × (1+120%)                                 = 4.62
 *   平均暴击倍率 = 0.575×4.62 + 0.425                      = 3.0815
 *   单弹头 = 173.7075 × 3.0815
 *   多重 = 1 + 90% = 1.90
 *   单次射击 = 单弹头 × 1.90
 *
 * 构建：膛线 + 分裂膛室 + 致命一击 + 弱点感应 + **地狱火**（+90% 火，用于验证元素加量）
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

const build = ['serration', 'split_chamber', 'point_strike', 'vital_sense', 'hellfire'];
const contribs = [];
for (const [i, id] of build.entries()) {
  const mod = modsJson.mods.find((m) => m.id === id);
  contribs.push(...adapter.modToContributions(mod, mod.maxRank, i));
}

const res = core.compute(weapon, mode, contribs, {
  kuva: { type: 'heat', ratio: 0.5 },
  faction: 'none',
  headshot: { enabled: false, multiplier: 3 },
});

// ── 手算 ──
const panel = 7.13 + 6.21 + 9.66;
const kuva = panel * 0.5;
const afterBase = (panel + kuva) * 2.65;
const heatBonus = afterBase * 0.9;
const cc = 0.23 * (1 + 1.5); // 致命一击 +150% ⇒ 0.575
const cd = 2.1 * (1 + 1.2); // 弱点感应 +120% ⇒ 4.62
const avgMul = cc * (cd - 1) + 1;
const handTotal = afterBase + heatBonus;

const checks = [
  ['加成后总伤', res.moddedPanelTotal, handTotal],
  ['单弹头命中（含暴击期望）', res.output.pelletPerHit, handTotal * avgMul],
  ['单次射击', res.output.perShot, handTotal * avgMul * 1.9],
  ['暴率', res.panelPairs.critChance.after, cc],
  ['总爆伤', res.panelPairs.critMultiplier.after, cd],
  ['多重', res.panelPairs.multishot.after, 1.9],
];

let ok = true;
for (const [name, actual, expected] of checks) {
  const pass = Math.abs(actual - expected) < 1e-6;
  if (!pass) ok = false;
  console.log(`${pass ? '✔' : '✖'} ${name.padEnd(14)} 内核 ${actual.toFixed(6).padStart(12)}   手算 ${expected.toFixed(6)}`);
}

console.log('\n元素分布（单弹头，未乘暴击）:');
for (const [k, v] of Object.entries(res.totalSpread)) console.log(`  ${k.padEnd(10)} ${v.toFixed(4)}`);

process.exit(ok ? 0 : 1);
