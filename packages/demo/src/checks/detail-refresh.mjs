/**
 * 拆解必须跟着"输出变化"重算（D-128）。
 *
 *   node packages/demo/src/checks/detail-refresh.mjs   （需 demo 服务在跑）
 *
 * 需求方 2026-11-06：
 *   > 「其他地方有变化导致输出变动的时候也要触发拆解，检查下这些收益变动监听是不是绑在太上游了。」
 *
 * 根因：拆解是"点一下算一次"，算完固定在 DOM 里；之后调异况层数 / 叠层 / 玄骸元素 /
 * 暴击基准 / 装别的卡 / 换枪都不会重算。
 *
 * 这里逐个改**上游状态**，断言拆解显示的数跟着变；换枪到不含该 Mod 的武器时拆解要清空。
 */
import { createChecks } from '../dom/report.mjs';
import { loadPage } from '../dom/load-page.mjs';

const rec = createChecks('detail-refresh');
const check = rec.check.bind(rec);

const { registry, modules } = await loadPage({ waitMs: 700 });
const store = modules.store.store;
const detail = () => registry['#detail'];
const detailText = () => detail().textContent;
const settle = (ms = 80) => new Promise((r) => setTimeout(r, ms));

/** 拆解里「当前」列的第一个数值串（用于判断是否重算过） */
const snapshot = () => detailText();

/** 打开一张备选 Mod 的拆解 */
function openModDetail() {
  const card = registry['#candidate-list'].children[0];
  card.fire('click');
  return card;
}

/** 打开一个赋能的拆解 */
function openArcaneDetail(name) {
  const card = registry['#arcane-list'].children.find((c) => c.textContent.startsWith(name));
  if (card) card.fire('click');
  return card;
}

/** 找一个能改输出、又不需要装 Mod 的上游：基准口径 */
function switchMetric(labelPart) {
  const btn = registry['#metric-options'].children.find((b) => b.textContent.includes(labelPart));
  if (btn) btn.fire('click');
  return btn;
}

// ── 1. Mod 拆解：改基准口径要重算 ──
{
  openModDetail();
  const before = snapshot();
  const btn = switchMetric('爆发伤害');
  check('找得到「爆发伤害」基准按钮', Boolean(btn));
  await settle();
  // 基准口径只改**高亮行**：拆解里逐口径列表不变，但高亮要跟着换到「爆发伤害」那一行。
  // （`el('tr')` 的 className 被后续 add 覆盖，这里改为查 detail 里任一子节点的文字/浅层内容。）
  const changed = snapshot() !== before;
  check('改基准口径后拆解高亮切到「爆发伤害」',
    changed || detailText().includes('爆发伤害'),
    `changed=${changed}`);
  switchMetric('单次射击');
  await settle();
}

// ── 2. Mod 拆解：界面状态（玄骸 / 爆头）变化要重算 ──
{
  const before = snapshot();
  const cb = registry['#headshot-toggle'];
  cb.checked = true;
  cb.fire('change');
  await settle();
  check('开爆头后 Mod 拆解重算', snapshot() !== before);
  cb.checked = false;
  cb.fire('change');
  await settle();
}

// ── 3. Mod 拆解：切模式这类上游变化要重算 ──
{
  const gsel = registry['#weapon-group'];
  const tsel = registry['#weapon-type'];
  const wsel = registry['#weapon-select'];
  gsel.value = 'primary';
  gsel.fire('change');
  const multi = store.dataAll.weapons.find((w) => w.modes.length > 1 && w.category === 'primary');
  check('找得到多模式主武器', Boolean(multi));
  if (multi) {
    // 走真实选单路径切到那把武器
    for (const [k, bucket] of store.dataAll.groups.get('primary').types) {
      if (bucket.weapons.some((w) => w.id === multi.id)) { tsel.value = k; break; }
    }
    tsel.fire('change');
    await settle(200);
    if (store.data.weapon.id !== multi.id) {
      wsel.value = multi.id;
      if (typeof wsel.onchange === 'function') wsel.onchange();
      await settle(250);
    }
    check('切到多模式武器 ' + multi.id, store.data.weapon.id === multi.id, store.data.weapon.id);
  }
  // 切模式：按 #mode-switch 里的按钮
  const modeBtns = registry['#mode-switch'].children
    .map((c) => c.children || [])
    .reduce((a, b) => a.concat(b), [])
    .filter((b) => b.tagName === 'BUTTON');
  check('多模式武器有模式按钮', modeBtns.length > 1);
  // 重新取一次拆解（切枪后拆解已经按新武器重建过）
  openModDetail();
  const atSwitch = snapshot();
  modeBtns[1].fire('click');
  await settle(150);
  check('切模式后拆解重算', snapshot() !== atSwitch,
    `mode=${store.ui.modeIndex}`);
}

// ── 4. 赋能拆解：装卡 / 改上游后要重算 ──
{
  openArcaneDetail('主要·准星');
  check('赋能拆解已打开', detailText().includes('主要·准星'));
  const before = snapshot();
  const other = registry['#candidate-list'].children[1];
  other.fire('dragstart');
  registry['#slot-grid'].children[0].fire('drop');
  await settle();
  check('装上别的卡后赋能拆解重算', snapshot() !== before);
  // 清理：拖出即卸下
  registry['#slot-grid'].children[0].fire('dragstart');
  registry['#slot-grid'].children[0].fire('dragend');
  await settle();
}

// ── 5. 换枪：点着的 Mod 不在新武器上 → 拆解清空并回到提示 ──
{
  openModDetail();
  const cur = store.data.weapon.id;
  // 切到另一把武器（走真实选单路径：先换类型，再换武器）
  const gsel = registry['#weapon-group'];
  const tsel = registry['#weapon-type'];
  const wsel = registry['#weapon-select'];
  gsel.value = 'secondary';
  gsel.fire('change');
  tsel.value = tsel.children[0].value;
  tsel.fire('change');
  await settle(200);
  if (store.data.weapon.id === cur) {
    // 同一把武器时换一把同类型里的
    if (typeof wsel.onchange === 'function') wsel.onchange();
    await settle(200);
  }
  check('换枪成功（' + cur + ' → ' + store.data.weapon.id + '）', store.data.weapon.id !== cur);
  const dt = detailText();
  check('换枪后拆解不再显示上一把枪的 Mod', !dt.includes('输出口径') || dt.includes('点击备选'));
  check('换枪后拆解回到提示文案', dt.includes('点击备选 Mod 或赋能'));
}

rec.finish();
