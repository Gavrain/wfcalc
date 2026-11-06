/**
 * 赋能词条与收益（D-116）。
 *
 *   node packages/demo/src/checks/arcane-showcase.mjs   （需 demo 服务在跑）
 *
 * 覆盖：
 *   · 待选区每张赋能卡都有词条行与「增幅」数值；
 *   · 词条与「算进内核的贡献」同源（显示的 = 算的）；
 *   · 关键口径：堡垒 +500%、过载 +350%、衰弱/滞阻/压缩 不计伤害词条、死首 +30% 爆头；
 *   · 装备区（赋能槽）也显示词条与收益；
 *   · 装上赋能后收益仍是数值（不 NaN），且与「拿掉它的边际贡献」同号。
 */
import { collect } from '../dom/shim.mjs';
import { createChecks } from '../dom/report.mjs';
import { loadPage } from '../dom/load-page.mjs';

const { registry, modules } = await loadPage({ waitMs: 700 });
const rec = createChecks('arcane-showcase');
const check = rec.check.bind(rec);

const adapter = modules.adapter;
const all = modules.store.store.dataAll;
const arcList = () => registry['#arcane-list'].children;
const arcSlot = () => registry['#arcane-slots'].children[0];
const candText = (card) => card.textContent;
const findArc = (name) => arcList().find((c) => candText(c).includes(name));
const gainOfCard = (card) => {
  const g = card.children.find((x) => (x.className || '').includes('cand-gain'));
  return g ? g.textContent : '';
};

// ── 1. 每张卡都词条 + 收益（D-123：没有伤害词条的卡不显示任何提示）──
check('赋能列表已渲染', arcList().length > 0);
const noChips = arcList().filter((c) => collect(c, 'slot-stat').length === 0);
const noGain = arcList().filter((c) => collect(c, 'slot-stat').length > 0 && !/增幅/.test(gainOfCard(c)));
check('有词条的卡都有「增幅」数值', noGain.length === 0);
if (noGain.length) console.error('  缺增幅：' + noGain.map(candText).join(' / '));
check('无词条的卡不写任何提示（D-123）',
  noChips.every((c) => c.textContent === (c.children[0] && c.children[0].textContent)),
  noChips.map(candText).join(' / '));
const noHint = arcList().filter((c) => c.textContent.includes('无伤害词条'));
check('卡上不再出现「无伤害词条（仅界面/机制类效果）」', noHint.length === 0, noHint.map(candText).join(' / '));

// D-123：赋能按增幅从高到低排
{
  const gains = arcList().map((c) => {
    const g = gainOfCard(c);
    const m = /([-+]?\d+(\.\d+)?)%/.exec(g);
    return c.children.some((x) => (x.className || '').includes('slot-stats')) ? (m ? Number(m[1]) : 0) : -Infinity;
  });
  let sorted = true;
  for (let i = 1; i < gains.length; i++) if (gains[i] > gains[i - 1] + 1e-9) sorted = false;
  check('赋能按增幅从高到低排列', sorted, gains.join(','));
}

// 有词条的卡：词条标签与贡献一致
const chipTexts = (card) => collect(card, 'slot-stat').map((n) => n.textContent);
const arcaneByZh = (name) => all.arcaneFile.arcanes.find((a) => (a.name.zh || a.name.en).includes(name));
for (const name of ['主要·无情', '主要·霜冻', '主要·堡垒', '主要·过载', '冷颤']) {
  const card = findArc(name);
  const arc = arcaneByZh(name);
  if (!card || !arc) continue;
  const shown = chipTexts(card).length;
  const contribs = adapter.arcaneToContributions(arc).length;
  check(`「${name}」的词条数与内核贡献数一致`, shown === contribs, `显示 ${shown} / 贡献 ${contribs}`);
}

// ── 2. 关键口径 ──
const arcOf = (key) => {
  const a = all.arcaneFile.arcanes.find((x) => x.key === key || x.id === key);
  if (!a) throw new Error('找不到赋能 ' + key);
  return a;
};
const capOf = (id) => adapter.arcaneDisplayStats(arcOf(id));
const bulwark = capOf('DamageForBonusArmour');
check('堡垒显示 +500%（不是 +1%）', bulwark.some((s) => s.stat === 'baseDamage' && s.amount === 500),
  JSON.stringify(bulwark));
const overcharge = capOf('MultishotForMaxEnergy');
check('过载显示 +350% 多重（不是 90%）', overcharge.some((s) => s.stat === 'multishot' && s.amount === 350),
  JSON.stringify(overcharge));
check('衰弱不产生伤害词条（不再 +1000% 触发）', capOf('SplitStatusProcsOnStackedStatusHit').length === 0);
check('滞阻不产生伤害词条（不再 +15% 触发）', capOf('PrimaryJamEnemyWeaponsOnMagneticProc').length === 0);
check('压缩不产生伤害词条（不再按爆炸半径换算）', capOf('ConvergeRadialAttackOnAim').length === 0);
const deadhead = capOf('PrimaryDamageOnNoMelee');
// D-118：弱点伤害 +30% **不随层数叠加**；基伤 +120% × 3 层 = +360%
// ⚠ D-123：这里量的是"算进内核的贡献"（`arcaneToContributions`），不是显示值——
//   两者现在同一份来源，显示值只负责上卡。
const deadheadContribs = adapter.arcaneToContributions(arcOf('PrimaryDamageOnNoMelee'));
check('死首弱点伤害 +30%（不叠加，不是 +90%）',
  deadheadContribs.some((c) => c.stat === 'weakpointDamage' && c.amount === 30), JSON.stringify(deadheadContribs.map((c) => c.stat + ':' + c.amount)));
check('死首基伤 +360%（每层 120% × 3 层）',
  deadheadContribs.some((c) => c.stat === 'baseDamage' && c.amount === 360), JSON.stringify(deadheadContribs.map((c) => c.stat + ':' + c.amount)));
check('死首不再占用爆头倍率分支',
  !deadheadContribs.some((c) => c.stat === 'headshotDamage'), JSON.stringify(deadheadContribs.map((c) => c.stat)));

// D-123：堡垒 / 过载的**收益**必须按真实值算（显示与实际同一份）
const bulwarkContribs = adapter.arcaneToContributions(arcOf('DamageForBonusArmour'));
check('堡垒实际贡献 = 基伤 +500（不是 +1）',
  bulwarkContribs.some((c) => c.stat === 'baseDamage' && c.amount === 500), JSON.stringify(bulwarkContribs));
const overchargeContribs = adapter.arcaneToContributions(arcOf('MultishotForMaxEnergy'));
check('过载实际贡献 = 多重 +350（不是 +35）',
  overchargeContribs.some((c) => c.stat === 'multishot' && c.amount === 350), JSON.stringify(overchargeContribs));

// 堡垒卡片上的文字
const bulwarkCard = findArc('主要·堡垒');
check('堡垒卡片文字含 +500', Boolean(bulwarkCard) && candText(bulwarkCard).includes('+500'),
  bulwarkCard ? candText(bulwarkCard) : '(没有这张卡)');

// ── 3. 装上赋能后：装备区有词条、收益是数值 ──
const target = findArc('主要·无情') ?? arcList()[0];
const targetName = target.children.find((x) => (x.className || '').includes('cand-top')).children[0].textContent;
const gainBefore = Number((/[-+]?\d+(\.\d+)?%/.exec(gainOfCard(target)) || [])[0].replace('%', ''));
check('待选区收益是具体数值', Number.isFinite(gainBefore), gainOfCard(target));

target.fire('dragstart');
arcSlot().fire('drop');
check('赋能已装备', arcSlot().textContent.includes(targetName), arcSlot().textContent);
check('装备区显示词条', collect(arcSlot(), 'slot-stat').length > 0, arcSlot().textContent);
check('装备区显示收益', arcSlot().textContent.includes('+') && arcSlot().textContent.includes('%'), arcSlot().textContent);
check('装备后列表里不再重复显示该赋能', !arcList().some((c) => candText(c).includes(targetName)));

// 收益与边际贡献同号
const store = modules.store.store;
const g = modules.compute.gainOf(store.arcaneKey);
check('赋能槽的边际贡献可计算', g !== null, String(g));
check('待选区收益与边际贡献同号', g === null || Math.sign(g) === Math.sign(gainBefore / 100) || Math.abs(gainBefore) < 0.01,
  `preview=${gainBefore}% marginal=${g === null ? 'null' : (g * 100).toFixed(2) + '%'}`);

// 所有卡片的增幅都不该是 NaN
const bad = arcList().filter((c) => candText(c).includes('NaN'));
check('待选区没有 NaN', bad.length === 0);

// ── 3b. 收益只按**当前口径**算（D-126，需求方纠正）──
// 当前口径对某个赋能不敏感时显示 +0.00% 是**正确结果**，不能拿别的口径的数顶替。
// 例：默认口径「单次射击」下，准星的弹药效率（只影响持续伤害）本来就没有收益。
{
  const starCard = findArc('主要·准星');
  if (starCard) {
    const before = gainOfCard(starCard);
    // 切到「持续伤害」口径后，弹药效率应当体现出来
    const metricBox = registry['#metric-options'];
    const btn = metricBox.children.find((b) => b.textContent.includes('持续伤害'));
    check('有「持续伤害」基准按钮', Boolean(btn));
    if (btn) {
      btn.fire('click');
      const after = gainOfCard(findArc('主要·准星'));
      check('切到「持续伤害」后准星收益变化（弹药效率生效）', after && after !== before,
        `单次射击 ${before} → 持续伤害 ${after}`);
    }
  }
  // 不论切到哪个口径，卡上的数都必须是「该口径下」的数：
  // 用 0 收益的哨兵——在「单次射击」口径下，纯弹药效率类赋能必须 +0.00%。
  const metricBox2 = registry['#metric-options'];
  const shotBtn = metricBox2.children.find((b) => b.textContent.includes('单次射击'));
  if (shotBtn) shotBtn.fire('click');
  const star2 = findArc('主要·准星');
  // 准星同时带触发 +300%，所以在单次射击口径下也不会是 0；这里断言的是"不会凭空变大"：
  const gNow = Number((/([-+]?\d+(\.\d+)?)%/.exec(gainOfCard(star2)) || [])[1]);
  check('单次射击口径下准星收益不会超过触发部分（不会借别的口径顶数）',
    Number.isFinite(gNow) && gNow <= 305, gainOfCard(star2));
}

// ── 4. 弹药效率真的进了指标（D-123）──
// 需求方：「准星的弹药效率这个词条为什么没生效」——以前只写进 `state.computed.等效弹匣`，
// `持续伤害` 根本没读它。现在持续伤害要按 1/(1−x) 放大。
{
  const compute = modules.compute;
  const arc = arcOf('StatusAndAmmoEfficiencyOnWeakpointHit');
  const extra = adapter.arcaneToContributions(arc);
  const contribs = compute.currentContributions();
  const valOf = (list, id) => (compute.runCompute(list).output.lines.find((l) => l.id === id) || {}).value;
  const before = valOf(contribs, 'sustainedDps');
  const after = valOf(contribs.concat(extra), 'sustainedDps');
  check('弹药效率提升「持续伤害」', after > before * 1.01, `${before.toFixed(3)} → ${after.toFixed(3)}`);
  check('弹药效率不改变「单发/爆发」口径',
    Math.abs(valOf(contribs.concat(extra), 'perShot') - valOf(contribs, 'perShot')) < 1e-9);
  // 弹匣 × M 后的持续伤害：单次×M·m/(M·m/fr+r) ÷ [单次×m/(m/fr+r)]
  //   ≠ M（因为装填时间里打得更久，占比也变了），所以这里用**同一公式逐项复算**，
  //   而不是简单断言乘 M。
  const panel = compute.runCompute(contribs).panelPairs;
  const mag = panel.magazineSize.after;
  const reload = panel.reloadTime.after;
  const o = compute.runCompute(contribs).output;
  const expected = (o.perShot * mag * 2.5) / ((mag * 2.5) / o.fireRate + reload);
  check('持续伤害按弹药效率倍数放大（弹匣 ×1/(1−x) 后代入同一公式）',
    Math.abs(after - expected) / Math.max(1, expected) < 1e-6,
    `${after.toFixed(4)} vs ${expected.toFixed(4)}`);
}

rec.finish();
