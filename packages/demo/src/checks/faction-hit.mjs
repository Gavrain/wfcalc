/**
 * 派系伤害对**命中伤害**生效（D-135）。
 *
 *   node packages/demo/src/checks/faction-hit.mjs   （纯内核，不需要 demo 服务）
 *
 * 需求方 2026-11-06：「派系伤害未对命中伤害生效，目前只对dot生效了。」
 *
 * 以前 `factionPct` 只传进了 `dotTick()`，`damageLine()` 没有乘派系 → 上「对 Grineer +30%」
 * 后 DoT 变了、命中/爆发/持续全不变。
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createChecks } from '../dom/report.mjs';
import { ROOT } from '../dom/load-page.mjs';
import { stripTemp } from '../strip-to-temp.mjs';

const rec = createChecks('faction-hit');
const check = rec.check.bind(rec);

const { transpile } = await import(pathToFileURL(join(ROOT, 'packages/demo/src/transpile.mjs')).href);
const core = await stripTemp(ROOT, 'packages/core/src/index.ts', transpile);
const adapter = await stripTemp(ROOT, 'packages/data/src/adapter.ts', transpile);

const weapons = JSON.parse(await readFile(join(ROOT, 'packages/data/src/generated/weapons/primary.json'), 'utf8'));
const modsJson = JSON.parse(await readFile(join(ROOT, 'packages/data/src/generated/mods/mods.json'), 'utf8'));
const weapon = weapons.weapons.find((w) => w.id === 'KuvaKarak');
const mode = weapon.modes.find((m) => m.id === 'primary');

/** 装 膛线 + 对 Grineer +30% */
const contribs = [];
for (const [i, id] of ['serration', 'bane_of_grineer'].entries()) {
  const mod = modsJson.mods.find((m) => m.id === id);
  contribs.push(...adapter.modToContributions(mod, mod.maxRank, i));
}
check('贡献里有 faction:grineer', contribs.some((c) => c.stat === 'faction:grineer'),
  JSON.stringify(contribs.map((c) => c.stat)));

const lineOf = (res, id) => (res.output.lines.find((l) => l.id === id) || {}).value;
const run = (faction) => core.compute(weapon, mode, contribs, { faction, kuva: null });

const none = run('none');
const grineer = run('grineer');
const corpus = run('corpus');

// D-137：§5.3 / §6.2③ 规定 DoT 的派系加成**两次**（基础值一次 + 每跳一次），
// 而命中侧只有一次 —— 所以命中 ×1.3，DoT 类指标 ×1.3² = ×1.69。
for (const id of ['pelletPerHit', 'perShot', 'hitDps', 'sustainedDps']) {
  const ratio = lineOf(grineer, id) / lineOf(none, id);
  check(`对 Grineer +30% 时「${id}」×1.3（命中只乘一次）`, Math.abs(ratio - 1.3) < 1e-9, ratio.toFixed(6));
}
for (const id of ['dotPerSecond', 'dot6s']) {
  const ratio = lineOf(grineer, id) / lineOf(none, id);
  check(`对 Grineer +30% 时「${id}」×1.69（DoT 按 §5.3 乘两次）`, Math.abs(ratio - 1.3 * 1.3) < 1e-9, ratio.toFixed(6));
}

// 换一张更高加成的派系卡（Prime +55%）：命中 ×1.55，DoT ×1.55² = ×2.4025
{
  const prime = modsJson.mods.find((m) => m.id === 'primed_bane_of_grineer');
  check('找得到 Prime 派系卡 primed_bane_of_grineer', Boolean(prime));
  if (prime) {
    const cPrime = [];
    for (const [i, id] of ['serration'].entries()) cPrime.push(...adapter.modToContributions(modsJson.mods.find((m) => m.id === id), 0, i));
    cPrime.push(...adapter.modToContributions(prime, prime.maxRank, 1));
    const pNone = core.compute(weapon, mode, cPrime, { faction: 'none', kuva: null });
    const pGri = core.compute(weapon, mode, cPrime, { faction: 'grineer', kuva: null });
    const hitRatio = lineOf(pGri, 'pelletPerHit') / lineOf(pNone, 'pelletPerHit');
    check('Prime 派系卡（+55%）时命中 ×1.55', Math.abs(hitRatio - 1.55) < 1e-9, hitRatio.toFixed(6));
    const dotRatio = lineOf(pGri, 'dotPerSecond') / lineOf(pNone, 'dotPerSecond');
    check('Prime 派系卡（+55%）时 DoT ×1.55² = ×2.4025（§5.3 两次）',
      Math.abs(dotRatio - 1.55 * 1.55) < 1e-9, dotRatio.toFixed(6));
  }
}

// 打别的派系：不该有任何加成
for (const id of ['pelletPerHit', 'perShot', 'hitDps']) {
  const ratio = lineOf(corpus, id) / lineOf(none, id);
  check(`打 Corpus 时「${id}」不变（异派系不加成）`, Math.abs(ratio - 1) < 1e-9, ratio.toFixed(6));
}

// 面板总伤 / 伤害分布不受派系影响（派系是命中结算，不在面板里）
check('面板总伤不随派系变化',
  Math.abs(grineer.moddedPanelTotal - none.moddedPanelTotal) < 1e-9,
  `${grineer.moddedPanelTotal} vs ${none.moddedPanelTotal}`);

// 派系乘在 v 上只乘一次：单弹头 = 合成总伤 × 派系 × 暴击期望 × 爆头
{
  const seg = grineer.segments[0];
  const spread = Object.values(seg.finalHit).reduce((a, b) => a + b, 0);
  const expected = spread * 1.3 * (1 + seg.critChance * (seg.critDamage - 1));
  check('单弹头 = 合成总伤 × 派系 × 暴击期望（只乘一次）',
    Math.abs(lineOf(grineer, 'pelletPerHit') - expected) < 1e-6,
    `${lineOf(grineer, 'pelletPerHit')} vs ${expected}`);
}

rec.finish();
