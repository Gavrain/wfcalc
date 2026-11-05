/**
 * 为 `docs/元素计算示例.md` 生成具体数字：每条规则都用真实 Mod 数据跑一遍。
 *   node packages/demo/src/gen-element-examples.mjs
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
const mods = modsJson.mods;
const karak = weapons.weapons.find((w) => w.id === 'KuvaKarak');

function contribsOf(ids) {
  const out = [];
  for (const [i, id] of ids.entries()) {
    const mod = mods.find((m) => m.id === id);
    if (!mod) throw new Error('no mod ' + id);
    out.push(...adapter.modToContributions(mod, mod.maxRank, i));
  }
  return out;
}

function run(ids, opts = {}) {
  const weapon = opts.weapon || karak;
  const mode = weapon.modes[0];
  return core.compute(weapon, mode, contribsOf(ids), {
    kuva: opts.kuva === undefined ? { type: 'heat', ratio: 0.5 } : opts.kuva,
    faction: 'none',
    headshot: { enabled: false, multiplier: 3 },
    ...(opts.co ? opts.co : {}),
  });
}

const fmt = (n, d = 4) => n.toFixed(d);

function show(title, ids, opts) {
  const res = run(ids, opts);
  const seg = res.segments[0];
  console.log('\n## ' + title);
  console.log('Mod: ' + ids.join(' + '));
  console.log('  基础面板  : ' + JSON.stringify(seg.panel));
  console.log('  玄骸后    : ' + JSON.stringify(round(seg.panelWithKuva)));
  console.log('  基伤后    : ' + JSON.stringify(round(seg.baseAfterBaseDamage)));
  console.log('  元素槽位  : ' + seg.elementDetail.slots.map((s) => `${s.source === 'panel' ? '面板' : 'Mod'}:${s.type}=${fmt(s.amount, 3)}`).join('  '));
  console.log('  合成结果  : ' + seg.elementDetail.compounds.map((s) => `${s.type}=${fmt(s.amount, 3)}`).join('  ') || '(无)');
  console.log('  未配对    : ' + (seg.elementDetail.singles.map((s) => `${s.type}=${fmt(s.amount, 3)}`).join('  ') || '(无)'));
  console.log('  最终分布  : ' + JSON.stringify(round(seg.finalHit, 3)));
  console.log('  加成后总伤: ' + fmt(res.moddedPanelTotal, 3));
}

function round(o, d = 6) {
  const out = {};
  for (const k of Object.keys(o)) out[k] = Number(o[k].toFixed(d));
  return out;
}

// ── 情形 1：只有元素 Mod（火），无元素配对 ──
show('情形 1：玄骸火 + 膛线 + 地狱火（火 Mod）', ['serration', 'hellfire']);

// ── 情形 2：单元素 Mod，无玄骸 ──
show('情形 2：无玄骸，膛线 + 燃烧箭头（火）', ['serration', 'hellfire'], { kuva: null });

// ── 情形 3：两张不同基础元素 → 复合 ──
show('情形 3：膛线 + 地狱火（火）+ 低温弹头（冰）→ 爆炸', ['serration', 'hellfire', 'cryo_rounds']);

// ── 情形 4：火 + 毒 → 毒气 ──
show('情形 4：膛线 + 地狱火 + 污染弹匣（毒）→ 毒气', ['serration', 'hellfire', 'infected_clip']);

// ── 情形 5：玄骸火 + 冰 Mod → 爆炸（面板元素参与配对）──
show('情形 5：玄骸火 50% + 低温弹头（冰）→ 爆炸', ['serration', 'cryo_rounds']);

// ── 情形 6：同类型两张 Mod 先合并 ──
show('情形 6：两张火 Mod（地狱火 + 野火）先合并', ['serration', 'hellfire', 'wildfire']);

// ── 情形 7：复合元素 Mod（生化弹药）给病毒与磁力，只生效一个 ──
show('情形 7：生化弹药（病毒+磁力 二选一）', ['serration', 'biotic_rounds']);

// ── 情形 8：物理 Mod 不参与复合，只放大自身 ──
show('情形 8：穿甲口径（穿刺 +120%）+ 地狱火', ['serration', 'piercing_caliber', 'hellfire']);
