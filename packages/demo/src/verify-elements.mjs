import { readFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripTemp } from './strip-to-temp.mjs';

const ROOT = normalize(join(fileURLToPath(new URL('.', import.meta.url)), '../../..'));
const { transpile } = await import(new URL('./transpile.mjs', import.meta.url).href);
const core = await stripTemp(ROOT, 'packages/core/src/index.ts', transpile);
const adapter = await stripTemp(ROOT, 'packages/data/src/adapter.ts', transpile);

const weapons = JSON.parse(await readFile(join(ROOT, 'packages/data/src/generated/weapons/primary.json'), 'utf8'));
const mods = JSON.parse(await readFile(join(ROOT, 'packages/data/src/generated/mods/mods.json'), 'utf8')).mods;
const karak = weapons.weapons.find((w) => w.id === 'KuvaKarak');

function contribsOf(ids) {
  const out = [];
  for (const [i, id] of ids.entries()) {
    const mod = mods.find((m) => m.id === id);
    out.push(...adapter.modToContributions(mod, mod.maxRank, i));
  }
  return out;
}
function run(ids, kuva = { type: 'heat', ratio: 0.5 }) {
  return core.compute(karak, karak.modes[0], contribsOf(ids), { kuva, faction: 'none' });
}

const cases = [
  ['情形1 火Mod', ['serration', 'hellfire'], 173.707],
  ['情形2 无玄骸', ['serration', 'hellfire'], 115.805, null],
  ['情形3 火冰→爆炸', ['serration', 'hellfire', 'cryo_rounds'], 255.990],
  ['情形4 火毒→毒气', ['serration', 'hellfire', 'infected_clip'], 255.990],
  ['情形5 玄骸火+冰', ['serration', 'cryo_rounds'], 173.707],
  ['情形6 两火合并', ['serration', 'hellfire', 'wildfire'], 228.563],
  ['情形7 生化弹药', ['serration', 'biotic_rounds'], 228.563],
  ['情形8 穿甲+火', ['serration', 'piercing_caliber', 'hellfire'], 193.455],
];

let ok = true;
for (const [name, ids, expected, kuva] of cases) {
  const res = kuva === null ? run(ids, null) : run(ids);
  const actual = Number(res.moddedPanelTotal.toFixed(3));
  const pass = Math.abs(actual - expected) < 5e-4;
  if (!pass) ok = false;
  const spread = {};
  for (const k of Object.keys(res.segments[0].finalHit)) spread[k] = Number(res.segments[0].finalHit[k].toFixed(3));
  console.log(`${pass ? '✔' : '✖'} ${name.padEnd(18)} 总伤 ${String(actual).padStart(8)}  ${JSON.stringify(spread)}`);
}
process.exit(ok ? 0 : 1);
