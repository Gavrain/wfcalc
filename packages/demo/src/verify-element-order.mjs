/**
 * D-025：武器自带元素（含玄骸）必须排在 8 个 Mod 槽位**之后**（槽位 9~12）。
 *   node packages/demo/src/verify-element-order.mjs
 *
 * 场景：玄骸火 50% + Mod 火 + Mod 毒
 *   正确（自带排后面）：Mod 火 与 Mod 毒 先配对 → 毒气；面板火 落单
 *   错误（自带排前面）：面板火 与 Mod 火 先合并，毒 落单 → 火 + 毒分离
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
const mods = JSON.parse(await readFile(join(ROOT, 'packages/data/src/generated/mods/mods.json'), 'utf8')).mods;
const karak = weapons.weapons.find((w) => w.id === 'KuvaKarak');

function run(ids, kuva = { type: 'heat', ratio: 0.5 }) {
  const contribs = [];
  for (const [i, id] of ids.entries()) {
    const mod = mods.find((m) => m.id === id);
    contribs.push(...adapter.modToContributions(mod, mod.maxRank, i));
  }
  return core.compute(karak, karak.modes[0], contribs, { kuva, faction: 'none' });
}

const checks = [];

// ── 场景 A：玄骸火（槽位 9）+ 火Mod（槽位 1）+ 毒Mod（槽位 2）──
// 正确顺序：Mod 火 与 Mod 毒 先配对成毒气；面板玄骸火随后并入**同类型**的火槽位（D-006），
//           此时火已全部转为毒气，所以最终是纯毒气，没有落单的火。
// 错误顺序（自带排前面）：玄骸火先与火Mod 合并 → 火槽位被提前消费，毒落单。
{
  const res = run(['serration', 'hellfire', 'infected_clip']);
  const seg = res.segments[0];
  const spread = seg.finalHit;
  checks.push(['A 出现毒气（Mod 火 + Mod 毒 先配对）', (spread.gas ?? 0) > 0]);
  checks.push(['A 无落单的火', (spread.heat ?? 0) === 0]);
  const slots = seg.elementDetail.slots;
  checks.push(['A 玄骸火 order = 9（Mod 槽位之后）', slots.some((s) => s.source === 'panel' && s.order >= 9)]);
  checks.push(['A Mod 槽位 order 在 0..7', slots.filter((s) => s.source === 'mod').every((s) => s.order >= 0 && s.order < 8)]);
}

// ── 场景 B：玄骸火 + 冰Mod（无火Mod）──
// 玄骸火在槽位 9，冰Mod 在槽位 0：冰先入队，等到火时配对 → 爆炸
{
  const res = run(['serration', 'cryo_rounds']);
  const spread = res.segments[0].finalHit;
  checks.push(['B 玄骸火 + 冰 → 爆炸', (spread.blast ?? 0) > 0]);
}

// ── 场景 C：槽位顺序决定配对（火在槽位0、毒在槽位1）──
{
  const res = run(['hellfire', 'infected_clip'], null);
  const spread = res.segments[0].finalHit;
  checks.push(['C 火+毒 → 毒气', (spread.gas ?? 0) > 0]);
}

// ── 场景 D：两个 Mod 互换槽位，复合结果类型不变但数值归属正确 ──
{
  const a = run(['hellfire', 'cryo_rounds'], null).segments[0].finalHit;
  const b = run(['cryo_rounds', 'hellfire'], null).segments[0].finalHit;
  checks.push(['D 槽位互换仍合成爆炸', (a.blast ?? 0) > 0 && (b.blast ?? 0) > 0]);
  checks.push(['D 互换后爆炸总量一致', Math.abs((a.blast ?? 0) - (b.blast ?? 0)) < 1e-9]);
}

let ok = true;
for (const [name, pass] of checks) {
  if (!pass) ok = false;
  console.log(`${pass ? '✔' : '✖'} ${name}`);
}
process.exit(ok ? 0 : 1);
