/**
 * 拆解对赋能生效 + 左边面板显示等效弹匣（D-125）；槽位布局（D-127）。
 *
 *   node packages/demo/src/checks/arcane-detail.mjs   （需 demo 服务在跑）
 *
 * 需求方 2026-11-06：
 *   > 「拆解也对赋能生效，然后左边当前面板那边，上了准星没有更新等效弹匣。」
 *   > 「赋能槽位和劣化槽位还是没有改大，改成跟普通槽位一样大，内部已经有标注这个是什么槽位了，
 *   >  外面就不需要有了，否则现在拖入赋能会导致槽位高度变化。」
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { collect } from '../dom/shim.mjs';
import { createChecks } from '../dom/report.mjs';
import { ROOT, loadPage } from '../dom/load-page.mjs';

const rec = createChecks('arcane-detail');
const check = rec.check.bind(rec);

const { registry, modules } = await loadPage({ waitMs: 700 });
// ⚠ 2026-11-12：守护 / 同伴武器（Gremlin 阿塔克斯）并进主要大类后成了默认武器，
//   它们**不能装赋能**，右侧赋能区是收起的 —— 本脚本要验证赋能本身，先切一把普通步枪。
//   守护武器禁用赋能由 `interact.mjs` 第 50 节专门验证。
if (typeof globalThis.__wfcalcSwitchWeapon === 'function') {
  await globalThis.__wfcalcSwitchWeapon('Rifle');
  await new Promise((r) => setTimeout(r, 400));
}
const store = modules.store.store;
const arcList = () => registry['#arcane-list'].children;
const arcSlot = () => registry['#arcane-slots'].children[0];
const detail = () => registry['#detail'];
const settle = (ms = 80) => new Promise((r) => setTimeout(r, ms));
const findArc = (name) => arcList().find((c) => c.textContent.startsWith(name));

// ── 1. 点赋能 → 拆解 ──
const star = findArc('主要·准星');
check('找得到「主要·准星」', Boolean(star));
if (star) {
  star.fire('click');
  const text = detail().textContent;
  check('点赋能后拆解显示该赋能名', text.includes('主要·准星'), text.slice(0, 60));
  check('拆解列出词条（触发几率 / 弹药效率）',
    text.includes('触发几率') && text.includes('弹药效率'), text.slice(0, 120));
  check('拆解有「输出口径 / 当前 / 装备后 / 增幅」表',
    text.includes('当前') && text.includes('装备后') && text.includes('增幅'));
  check('拆解里「续航秒伤」这一行有增幅（弹药效率生效）',
    /续航秒伤[^]*?%/.test(text), text.slice(0, 200));
  // 依据：核心事实 §3（弹药效率）。面板「弹匣容量」直接显示等效弹匣，
  // 不再单列「等效弹匣」行，也不再写「按弹药效率折算」的括号说明。
  {
    const boxes = detail().children.filter((c) => (c.className || '').includes('merge-box'));
    const pbox = boxes.find((b) => (b.children[0] || {}).textContent === '面板');
    check('有「面板」表（不再叫「面板变动」）', Boolean(pbox),
      boxes.map((b) => (b.children[0] || {}).textContent).join('/'));
    const ptext = pbox ? pbox.textContent : '';
    check('面板表头是「当前 / 装备后 / 增幅」',
      ['当前', '装备后', '增幅'].every((h) => ptext.includes(h)), ptext.slice(0, 60));
    check('面板表不再有过时的「按弹药效率折算」说明',
      !ptext.includes('按弹药效率折算'), ptext.slice(0, 160));
    check('暴击几率 / 暴击伤害在拆解里只出现一次（D-132 合并后）',
      (detail().textContent.match(/暴击伤害/g) || []).length <= 1,
      '暴击伤害 出现 ' + (detail().textContent.match(/暴击伤害/g) || []).length + ' 次');
    check('不再有「面板变动 / 暴击变动」这类措辞',
      !detail().textContent.includes('面板变动') && !detail().textContent.includes('暴击变动'), detail().textContent.slice(0, 80));
  }
}

// 另一个点：随便点一张别的赋能也能拆解
{
  const other = arcList().find((c) => !c.textContent.startsWith('主要·准星') && collect(c, 'slot-stat').length > 0);
  if (other) {
    other.fire('click');
    check('点其它赋能也能拆解', detail().children.length > 0 && detail().textContent.length > 20);
  }
}

// Mod 的拆解不受影响
{
  const modCard = registry['#candidate-list'].children[0];
  modCard.fire('click');
  check('Mod 拆解仍然可用', detail().textContent.includes('输出口径') || detail().textContent.includes('当前'));
}

// ── 2. 左边面板：装上准星后，弹匣容量要变成等效弹匣（弹药效率 60% → ×2.5，100 → 250）──
const panelText = () => registry['#panel-table'].textContent;
{
  // 面板行是「弹匣容量 → 基础面板 → 当前面板」，两个数都是两位小数（如 100.00 100.00）
  const magazineText = () => {
    const m = /弹匣容量(\d+\.\d{2})(\d+\.\d{2})/.exec(panelText());
    return m ? { base: Number(m[1]), after: Number(m[2]) } : null;
  };
  const before = magazineText();
  check('未装准星时弹匣容量 = 基础弹匣', Boolean(before) && before.after === before.base);
  if (star) {
    star.fire('dragstart');
    arcSlot().fire('drop');
    await settle();
    check('准星已装上', Boolean(store.arcaneKey));
    const after = magazineText();
    check('装上准星后弹匣容量 = 基础 × 2.5（弹药效率 60%）',
      Boolean(after) && Boolean(before) && Math.abs(after.after - before.base * 2.5) < 0.01,
      JSON.stringify(after));
    // 卸下后恢复
    arcSlot().fire('dragstart');
    registry['#arcane-list'].fire('drop');
    await settle();
    const restored = magazineText();
    check('卸下准星后弹匣容量恢复', Boolean(restored) && restored.after === restored.base, JSON.stringify(restored));
  }
}

// ── 3. 槽位布局（D-127）：赋能 / 劣化槽与 Mod 槽同尺寸，且装入后不改变高度 ──
{
  // DOM shim 不维护 parentNode 之外的层级关系，槽位容器的结构直接查 index.html
  const arcSlotEl = arcSlot();
  const exSlotEl = registry['#side-slots'].children[0];
  check('赋能槽存在', Boolean(arcSlotEl));
  check('劣化槽存在', Boolean(exSlotEl));
  // 槽名写在槽内（.slot-title / .slot-chip），外面没有「赋能 / 劣化」小标题
  const htmlSrc = await readFile(join(ROOT, 'packages/demo/public/index.html'), 'utf8');
  check('外面不再挂「赋能 / 劣化」小标题', !htmlSrc.includes('side-label'));
  // D-133：侧栏是窄栏单列（两张槽竖排），不再与 Mod 槽区等宽横铺
  const cssSrc = await readFile(join(ROOT, 'packages/demo/public/app.css'), 'utf8');
  check('侧栏是单列窄栏（width: 190px，非 grid 两列）',
    /\.side-column \{[^}]*width: 190px/.test(cssSrc) && !/\.side-column \{[^}]*grid-template-columns/.test(cssSrc));
  check('槽名在槽内（赋能）',
    (arcSlotEl.textContent || '').includes('赋能'), (arcSlotEl.textContent || '').slice(0, 40));
  check('槽名在槽内（劣化）',
    (exSlotEl.textContent || '').includes('劣化'), (exSlotEl.textContent || '').slice(0, 40));

  // 节点数在装入前后不变（标题行去掉后，不会再因为"装入"多长出一行撑高）
  const beforeCount = exSlotEl.children.length;
  const exCard = registry['#candidate-list'].children.find((c) => collect(c, 'tag').some((t) => t.textContent === '功能'));
  if (exCard) {
    exCard.fire('dragstart');
    exSlotEl.fire('drop');
    await settle();
    const afterCount = registry['#side-slots'].children[0].children.length;
    check('劣化槽装入前后子节点数一致（高度不跳）', beforeCount === afterCount,
      `before ${beforeCount} / after ${afterCount}`);
  }
}

// ── 4. 赋能槽有赋能时，别的赋能也能装（互换，与 Mod 槽 / 劣化槽一致）（D-134）──
{
  const slot = () => registry['#arcane-slots'].children[0];
  const list = () => registry['#arcane-list'].children;
  const first = list()[0];
  const firstName = first.children[0].children[0].textContent;
  first.fire('dragstart');
  slot().fire('drop');
  await settle();
  check('第一个赋能装上（' + firstName + '）', store.arcaneKey && slot().textContent.includes(firstName));

  const second = list()[0];
  const secondName = second.children[0].children[0].textContent;
  check('列表里还有别的赋能可装（' + secondName + '）', Boolean(second) && secondName !== firstName);
  second.fire('dragstart');
  slot().fire('drop');
  await settle();
  check('槽里已有赋能时，拖入别的赋能 = 互换', slot().textContent.includes(secondName), slot().textContent);
  check('被换下的赋能回到列表', list().some((c) => c.textContent.startsWith(firstName)));

  // 大差不匹配的赋能不能被装进当前武器的槽（近战赋能 vs 主要武器）
  const meleeArc = store.dataAll.arcaneFile.arcanes.find((a) => a.category === 'melee');
  if (meleeArc) {
    const before = store.arcaneKey;
    // 构造一个"拖近战赋能"的假卡片：直接走槽的 dragover 判断
    let prevented = false;
    for (const h of slot()._listeners.dragover ?? []) {
      h({ preventDefault() { prevented = true; }, dataTransfer: {} });
    }
    // 先把 dragPayload 设成近战赋能再判断
    store.dragPayload = { kind: 'arcane', key: meleeArc.key, category: 'melee', from: 'list' };
    prevented = false;
    for (const h of slot()._listeners.dragover ?? []) {
      h({ preventDefault() { prevented = true; }, dataTransfer: {} });
    }
    check('别的大类的赋能不能进当前赋能槽', prevented === false, 'prevented=' + prevented);
    slot().fire('drop');
    await settle();
    check('拖别的大类的赋能不改变槽内容', store.arcaneKey === before, String(store.arcaneKey));
    store.dragPayload = null;
  }
}

rec.finish();
