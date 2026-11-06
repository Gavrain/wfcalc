/**
 * 镀层加成控件（D-117）：0 层可选、推演小字挪到镀层 Mod 卡上。
 *
 *   node packages/demo/src/checks/co-controls.mjs   （需 demo 服务在跑）
 *
 * 需求方 2026-11-06：
 *   > 「目前镀层基伤无法选择0层，请修改，然后镀层加成那边的小字推演去掉，
 *   >  这应该是放到镀层mod本身上显示的。」
 *
 * 覆盖：
 *   · 装了镀层卡时，「叠加层数」可选 0，且选 0 后真的按 0 层算（叠层失效 → 指标变化）；
 *   · 选 0 之后再选别的层数，数值能回去（0 不再被当成"未指定"）；
 *   · 「敌人异况层数」选 0 也生效；
 *   · 配置区没有任何推演小字；镀层卡上仍有「增幅」数值；
 *   · 换枪后层数默认值回到上限。
 */
import { findDeep } from '../dom/shim.mjs';
import { createChecks } from '../dom/report.mjs';
import { loadPage, invokeBoot } from '../dom/load-page.mjs';

const rec = createChecks('co-controls');
const check = rec.check.bind(rec);

const { registry, modules } = await loadPage({ waitMs: 600 });
const store = modules.store.store;
const compute = modules.compute;
const coBox = () => registry['#co-controls'];
const grid = () => registry['#slot-grid'].children;

/** 配置区里「叠加层数」那个 select */
function stacksSelect() {
  const sel = findDeep(coBox(), 'select');
  return sel;
}
/** 配置区里「敌人异况层数」那个 input */
function statusInput() {
  const inp = findDeep(coBox(), 'input');
  return inp;
}
const metric = () => compute.metricValueOf(compute.runCompute(compute.currentContributions()));

/** 备选区里第一张「镀层系列（基伤）」Mod 的卡片与 id */
function firstCoCard() {
  for (const mod of store.data.availableMods) {
    if (!modules.adapter.isConditionOverloadMod(mod)) continue;
    const card = registry['#candidate-list'].children.find((c) => (c.textContent || '').startsWith(mod.name.zh || mod.name.en));
    if (card) return { mod, card };
  }
  return null;
}

// ── 1. 装上一张镀层卡 ──
const co = firstCoCard();
check('备选区能找到镀层系列（基伤）Mod', Boolean(co));
if (!co) { rec.finish(); }
/** 等一帧让页面重渲染完（同步触发 drag/drop 会把渲染叠在一起） */
const settle = () => new Promise((r) => setTimeout(r, 0));
co.card.fire('dragstart');
grid()[0].fire('drop');
await settle();
check('镀层卡已装上', grid()[0].textContent.includes(co.mod.name.zh || co.mod.name.en));
const coNow = compute.coInfo();
check('coInfo 变成已装备', coNow.active === true);

// ── 2. 下拉里有 0，且 0 是合法选择 ──
const ySel = stacksSelect();
check('配置区有「叠加层数」下拉', Boolean(ySel));
const options = ySel.children.map((o) => Number(o.value));
check('下拉包含 0 层', options.includes(0));
check('下拉覆盖 0..叠层上限', options.length === coNow.maxStacks + 1, options.join(','));
check('默认值是叠层上限（' + ySel.value + '/' + coNow.maxStacks + '）', Number(ySel.value) === coNow.maxStacks);

// 先把异况数调成 3，否则 0 层和满层的差别会被 a=0 吃掉
statusInput().value = '3';
statusInput().fire('input');
const fullStacks = metric();
ySel.value = '0';
ySel.fire('change');
check('选 0 层后下拉值就是 0（不再是"未指定→上限"）', Number(stacksSelect().value) === 0);
const zeroStacks = metric();
check('0 层真的生效（指标比满层低）', zeroStacks < fullStacks, `${zeroStacks} vs ${fullStacks}`);
check('0 层时 computeOptions 传的 coStacks 是 0', compute.computeOptions().coStacks === 0);

// 再切回满层，数值应复原
stacksSelect().value = String(coNow.maxStacks);
stacksSelect().fire('change');
check('再切回满层，指标复原', Math.abs(metric() - fullStacks) < 1e-9);

// ── 3. 异况层数 0 也生效 ──
const beforeZeroStatus = metric();
statusInput().value = '0';
statusInput().fire('input');
check('敌人异况层数 0 生效（叠层加成消失）', metric() < beforeZeroStatus);
statusInput().value = '3';
statusInput().fire('input');

// ── 4. 配置区没有推演小字，卡上有收益 ──
check('配置区不再有「假设装备」小字', !coBox().textContent.includes('假设装备'));
check('配置区不再有「每层 … × … 层」公式小字', !/每层/.test(coBox().textContent));
check('配置区不再有「装备后约」推演', !coBox().textContent.includes('装备后约'));
const slotCard = grid()[0];
check('已装镀层卡上仍显示贡献徽标', /[+-]\d+(\.\d+)?%/.test(slotCard.textContent), slotCard.textContent);

// 备选区里其它镀层卡（若有）显示的是数值增幅而不是空
const otherCo = store.data.availableMods.find(
  (m) => modules.adapter.isConditionOverloadMod(m) && m.id !== co.mod.id,
);
if (otherCo) {
  const card = registry['#candidate-list'].children.find((c) => (c.textContent || '').startsWith(otherCo.name.zh || otherCo.name.en));
  if (card) check('备选区镀层卡也有增幅数值', /增幅\s*[+-]?\d/.test(card.textContent), card.textContent);
}

// ── 5. 换枪后默认层数回到上限 ──
await invokeBoot();
await new Promise((r) => setTimeout(r, 400));
const coAfter = compute.coInfo();
const yAfter = findDeep(coBox(), 'select');
check('重启后「叠加层数」默认是上限', Boolean(yAfter) && Number(yAfter.value) === coAfter.maxStacks,
  yAfter ? `${yAfter.value}/${coAfter.maxStacks}` : '(没有下拉)');

rec.finish();
