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

function run(ids, extra = []) {
  const c = [];
  for (const [i, id] of ids.entries()) {
    const m = mods.find((x) => x.id === id);
    for (const x of adapter.modToContributions(m, m.maxRank, i)) c.push(x);
  }
  for (const x of extra) c.push(x);
  return core.compute(karak, karak.modes[0], c, { kuva: { type: 'heat', ratio: 0.6 }, faction: 'none' });
}

const ids = ['serration', 'split_chamber', 'point_strike', 'vital_sense', 'hellfire', 'infected_clip', 'vigilante_armaments', 'heavy_caliber'];
const a = run(ids);
// 加 +60% 射速
const b = run(ids, [{ stat: 'fireRate', form: 'pct', amount: 60, source: 'speed_trigger' }]);

const line = (r, id) => r.output.lines.find((l) => l.id === id).value;
console.log('射速        无加成 :', a.output.fireRate.toFixed(3));
console.log('射速        +60%   :', b.output.fireRate.toFixed(3), ' ← 射速确实变了');
console.log('');
console.log('DoT 每层秒伤 无加成 :', line(a, 'dotPerSecond').toFixed(4));
console.log('DoT 每层秒伤 +60%   :', line(b, 'dotPerSecond').toFixed(4), ' ← 应该不变');
console.log('');
console.log('DoT 六秒总伤 无加成 :', line(a, 'dot6s').toFixed(2));
console.log('DoT 六秒总伤 +60%   :', line(b, 'dot6s').toFixed(2), ' ← 应随射速上升');

let ok = true;
const near = (x, y) => Math.abs(x - y) < 1e-6;
if (!near(line(a, 'dotPerSecond'), line(b, 'dotPerSecond'))) { ok = false; console.log('✖ 射速影响了每层秒伤！'); }
else console.log('✔ 射速不再影响每层秒伤');
if (!(line(b, 'dot6s') > line(a, 'dot6s'))) { ok = false; console.log('✖ 六秒总伤未随射速变化'); }
else console.log('✔ 六秒总伤随射速上升');
process.exit(ok ? 0 : 1);
