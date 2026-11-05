/**
 * 镀层类（A-03 / D-024）数值对账：
 *   镀层加量 = x% × a × y
 *   赤毒·卡拉克：膛线(+165%) + 镀层 步枪才能(20%/层, y=2)
 *   面板 23 → 玄骸火 50% = 11.5 → 面板 34.5
 *   a=3 → 镀层 = 20% × 3 × 2 = +120%
 *   基伤系数 = 1 + 165% + 120% = 3.85 → 34.5 × 3.85 = 132.825
 *   a=0 → 基伤系数 = 1 + 165% = 2.65 → 34.5 × 2.65 = 91.425
 *
 *   node packages/demo/src/verify-co.mjs
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

const contribs = [];
for (const [i, id] of ['serration', 'galvanized_aptitude'].entries()) {
  const mod = modsJson.mods.find((m) => m.id === id);
  contribs.push(...adapter.modToContributions(mod, mod.maxRank, i));
}

const co = contribs.filter((c) => c.stat === 'co');
const coMod = modsJson.mods.find((m) => m.id === 'galvanized_aptitude');
const maxStacks = coMod.conditions.find((c) => c.group === 'condition_overload').maxStacks;
const x = co[0].amount;
const y = maxStacks;

const run = (a) =>
  core.compute(weapon, mode, contribs, {
    kuva: { type: 'heat', ratio: 0.5 },
    coStacks: y,
    coStatusTypes: a,
  });

const panel = 7.13 + 6.21 + 9.66;
const withKuva = panel * 1.5; // 34.5

const checks = [];
for (const a of [0, 1, 2, 3]) {
  const expected = withKuva * (1 + 1.65 + (x / 100) * a * y);
  const res = run(a);
  // 用爆发分布合计校验（无元素 Mod，加成后总伤 = 基伤放大后的面板）
  checks.push([`a=${a} 加成后面板总伤`, res.moddedPanelTotal, expected]);
}

console.log(`镀层步枪才能：x=${x}%  y=${y}（maxStacks）  ⇒ a=3 时 +${x * 3 * y}% 基伤`);
let ok = true;
for (const [name, actual, expected] of checks) {
  const pass = Math.abs(actual - expected) < 1e-9;
  if (!pass) ok = false;
  console.log(`${pass ? '✔' : '✖'} ${name.padEnd(18)} 内核 ${actual.toFixed(4).padStart(10)}   手算 ${expected.toFixed(4)}`);
}
process.exit(ok ? 0 : 1);
