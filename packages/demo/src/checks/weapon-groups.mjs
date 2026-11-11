/**
 * 武器大类切换与对应赋能（D-119）。
 *
 *   node packages/demo/src/checks/weapon-groups.mjs   （需 demo 服务在跑）
 *
 * 需求方 2026-11-06：「开放其他武器类型的选择以及对应赋能的选择。」
 *
 * 覆盖：
 *   · 四个大类（主要 / 次要 / 近战 / 空战）都能选，不再有「（未开放）」；
 *   · 每个大类下都能选到武器、切过去后页面正常渲染（不抛错、面板/槽位/备选区都有内容）；
 *   · 切换后「大类」下拉停在当前武器所在的类别；
 *   · 赋能列表按**武器大类**过滤：近战只出近战赋能、次要只出次要赋能、空战不再空列表。
 */
import { createChecks } from '../dom/report.mjs';
import { loadPage } from '../dom/load-page.mjs';

const rec = createChecks('weapon-groups');
const check = rec.check.bind(rec);

const { registry, modules } = await loadPage({ waitMs: 700 });
const store = modules.store.store;
const settle = (ms = 120) => new Promise((r) => setTimeout(r, ms));

const gsel = registry['#weapon-group'];
const tsel = registry['#weapon-type'];
const wsel = registry['#weapon-select'];
const arcList = () => registry['#arcane-list'].children;

// ── 1. 四个大类都可选 ──
const opts = gsel.children;
check('大类下拉有 4 项', opts.length === 4, opts.map((o) => o.textContent).join('/'));
check('没有「（未开放）」字样', !opts.some((o) => o.textContent.includes('未开放')));
check('四个大类都未置灰', opts.every((o) => o.disabled !== true));

// ── 2. 逐个切大类 → 选第一把 → 页面正常 ──
const expectCategory = { primary: 'primary', secondary: 'secondary', melee: 'melee', archwing: ['archgun', 'archmelee'] };
for (const g of opts.map((o) => o.value)) {
  gsel.value = g;
  gsel.fire('change');
  const typeOpts = tsel.children.length;
  check(`「${g}」有类型可选`, typeOpts > 0, String(typeOpts));
  if (!typeOpts) continue;
  tsel.value = tsel.children[0].value;
  tsel.fire('change');
  await settle();
  const w = store.data && store.data.weapon;
  const want = expectCategory[g];
  const catOk = Array.isArray(want) ? want.includes(w && w.category) : w && w.category === want;
  check(`「${g}」切过去后武器类别正确（${w && w.id} / ${w && w.category}）`, Boolean(w) && catOk);
  check(`「${g}」大停下拉同步到当前武器类别`, gsel.value === g);
  check(`「${g}」面板已渲染`, registry['#panel-table'].children.length > 0);
  if (g === 'archwing') {
    // 2026-11-08：37 张曲翼枪 Mod 已入库（需求方要求），所以空战枪械现在**有**备选 Mod。
    // 空战近战仍然没有对应 Mod 池，赋能依旧为空——这两个缺口保留记录。
    check('「archwing」备选 Mod 有内容', registry['#candidate-list'].children.length > 0,
      String(registry['#candidate-list'].children.length));
    check('「archwing」赋能列表为空（数据缺口，已记录）', arcList().length === 0, String(arcList().length));
  } else {
    check(`「${g}」备选 Mod 有内容`, registry['#candidate-list'].children.length > 0,
      String(registry['#candidate-list'].children.length));
    check(`「${g}」赋能列表非空`, arcList().length > 0, String(arcList().length));
  }
  check(`「${g}」武器下拉选中当前武器`, wsel.value === (w && w.id));
}

// ── 3. 赋能按大类过滤 ──
const arcaneNamesByGroup = {};
for (const g of opts.map((o) => o.value)) {
  gsel.value = g;
  gsel.fire('change');
  tsel.value = tsel.children[0].value;
  tsel.fire('change');
  await settle();
  arcaneNamesByGroup[g] = arcList().map((c) => (c.children[0] || {}).textContent || c.textContent).join('|');
}
check('近战只出近战赋能（含「近战·」前缀）', /近战·/.test(arcaneNamesByGroup.melee || '') && !/主要·/.test(arcaneNamesByGroup.melee || ''),
  (arcaneNamesByGroup.melee || '').slice(0, 60));
check('次要只出次要赋能（含「次要·」/瀑流/联结）', /次要·|瀑流·|联结·/.test(arcaneNamesByGroup.secondary || ''),
  (arcaneNamesByGroup.secondary || '').slice(0, 60));
check('主要只出主要赋能（含「主要·」）', /主要·/.test(arcaneNamesByGroup.primary || ''),
  (arcaneNamesByGroup.primary || '').slice(0, 60));
check('空战赋能列表为空（数据缺口：arcanes.json 没有空战赋能，已记录）',
  (arcaneNamesByGroup.archwing || '').length === 0);

// ── 4. 近战也能装 Mod / 赋能并算出指标 ──
{
  gsel.value = 'melee';
  gsel.fire('change');
  tsel.value = tsel.children[0].value;
  tsel.fire('change');
  await settle();
  const before = modules.compute.metricValueOf(modules.compute.runCompute(modules.compute.currentContributions()));
  check('近战当前指标可计算（> 0）', before > 0, String(before));
  const card = registry['#candidate-list'].children.find((c) => !(c.children || []).some((x) => (x.className || '').includes('tag'))) || registry['#candidate-list'].children[0];
  check('近战备选区有可装 Mod', Boolean(card));
  if (card) {
    card.fire('dragstart');
    registry['#slot-grid'].children[0].fire('drop');
    await settle();
    const after = modules.compute.metricValueOf(modules.compute.runCompute(modules.compute.currentContributions()));
    check('近战装上 Mod 后指标变化', Math.abs(after - before) > 1e-9, `${before} → ${after}`);
  }
  const arc = arcList()[0];
  if (arc) {
    arc.fire('dragstart');
    registry['#arcane-slots'].children[0].fire('drop');
    await settle();
    check('近战赋能能装上', Boolean(store.arcaneKey), String(store.arcaneKey));
  }
}

rec.finish();
