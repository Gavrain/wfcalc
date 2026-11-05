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

function run(ids) {
  const c = [];
  for (const [i, id] of ids.entries()) {
    const m = mods.find((x) => x.id === id);
    for (const x of adapter.modToContributions(m, m.maxRank, i)) c.push(x);
  }
  return core.compute(karak, karak.modes[0], c, { kuva: { type: 'heat', ratio: 0.6 }, faction: 'none' }, false);
}

const base = run(['serration', 'split_chamber']);
const withReload = run(['serration', 'split_chamber', 'fast_hands']);
const withMag = run(['serration', 'split_chamber', 'magazine_warp']);

const s = (r) => r.output.lines.find((l) => l.id === 'sustainedDps').value;
console.log('持续伤害 无装填Mod :', s(base).toFixed(4));
console.log('持续伤害 +爆发装填 :', s(withReload).toFixed(4), ' 变化:', ((s(withReload) / s(base) - 1) * 100).toFixed(2) + '%');
console.log('持续伤害 +弹匣增幅 :', s(withMag).toFixed(4), ' 变化:', ((s(withMag) / s(base) - 1) * 100).toFixed(2) + '%');

let ok = true;
if (!(s(withReload) > s(base))) { ok = false; console.log('✖ 装填 Mod 未提升持续伤害'); }
else console.log('✔ 装填 Mod 提升持续伤害');
if (!(s(withMag) > s(base))) { ok = false; console.log('✖ 弹匣 Mod 未提升持续伤害'); }
else console.log('✔ 弹匣 Mod 提升持续伤害');
process.exit(ok ? 0 : 1);
