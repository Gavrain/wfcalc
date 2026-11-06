/**
 * 页面交互冒烟（原 `dom-interact.mjs`，D-103 用公共 shim 重写入口）。
 *
 *   node packages/demo/src/checks/interact.mjs
 *
 * 从**真实 index.html** 建 DOM，把 app.js 的渲染与事件路径真跑一遍。
 * 为什么用 shim 而不是真浏览器：沙箱里 Chrome 起不来。
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { findDeep } from '../dom/shim.mjs';
import { createChecks } from '../dom/report.mjs';
import { ROOT, loadPage, invokeBoot } from '../dom/load-page.mjs';

const { registry, modules } = await loadPage({ waitMs: 400 });
const issuesMod = modules.issues;
const store = modules.store;
const rec = createChecks('interact');
const check = rec.check.bind(rec);

// ── helpers ──
const grid = () => registry['#slot-grid'].children;
const slotTexts = () => grid().map((c) => c.textContent);
const findCard = (name) => registry['#candidate-list'].children.find((c) => c.textContent.includes(name));
const outText = () => registry['#output-list'].children.map((c) => c.textContent).join('|');
/** 槽位里那张 Mod 的名字（去掉"槽位 N"标题与按钮文字） */
function slotModName(i) {
  const card = grid()[i];
  if (!card) return null;
  let body = null;
  for (const c of card.children) {
    if (c.tagName === 'DIV' && (c.className || '').indexOf('slot-body') >= 0) body = c;
  }
  if (!body) return null;
  for (const c of body.children) {
    if ((c.className || '').indexOf('slot-name') >= 0) return c.textContent;
  }
  return null;
}
const slotNames = () => grid().map((_, i) => slotModName(i));

/** 模拟"把槽位 i 的 Mod 拖出去丢掉"（D-040：成功 drop 到别处才算，这里是 dragend 无 drop） */
function dragOutSlot(i) {
  const card = grid()[i];
  card.fire('dragstart');
  card.fire('dragend');
}

/**
 * 把 8 个槽位重新装满，给后续"插入"类断言一个干净起点。
 * ⚠ 已装备的 Mod 不再出现在备选区（D-034），所以每装一张都要**重新取列表**。
 */
function recoverFullSlots() {
  const names = ['膛线', '分裂膛室', '致命一击', '弱点感应', '地狱火', '污染弹匣', '私法 军备', '重口径'];
  for (let i = 0; i < grid().length; i++) dragOutSlot(i);
  for (let i = 0; i < names.length; i++) {
    let card = null;
    for (const c of registry['#candidate-list'].children) {
      const top = c.children.find((x) => (x.className || '').indexOf('cand-top') >= 0);
      // 精确匹配名字（「私法 军备」不能被「私法 热诚」误命中）
      if (top && top.children[0].textContent === names[i]) { card = c; break; }
    }
    if (card) { card.fire('dragstart'); grid()[i].fire('drop'); }
  }
}

const html = await readFile(join(ROOT, 'packages/demo/public/index.html'), 'utf8');
const appSrc = await readFile(join(ROOT, 'packages/demo/public/app.js'), 'utf8');

// ── 14. app.js 引用的 id 都在 index.html ──
{
  const htmlIds = new Set();
  for (const m of html.matchAll(/\bid="([^"]+)"/g)) htmlIds.add(m[1]);
  const used = new Set();
  for (const m of appSrc.matchAll(/\$\('#([\w-]+)'\)/g)) used.add(m[1]);
  const missing = [...used].filter((id) => !htmlIds.has(id));
  check(`app.js 引用的 ${used.size} 个 id 都存在于 index.html`, missing.length === 0);
  if (missing.length) console.error('  缺失：' + missing.join(', '));
}

// ── 15. 口径命名与单位（D-033）──
{
  const out = registry['#output-list'];
  const text = out.textContent;
  check('口径含「单弹头」且标 /弹头', text.includes('单弹头') && text.includes('/弹头'));
  check('口径含「单次射击」且标 /发', text.includes('单次射击') && text.includes('/发'));
  check('「每秒命中」已改名「爆发伤害」', text.includes('爆发伤害') && !text.includes('每秒命中'));
  check('「持续射击」已改名「持续伤害」', text.includes('持续伤害'));
  check('DoT 改为「加权每层秒伤」与「六秒异常状态总伤」（D-057/D-060）',
    text.includes('DoT 加权每层秒伤') && text.includes('六秒异常状态总伤'));
  check('旧名「DoT 六秒总伤」已不存在', !text.includes('DoT 六秒总伤'));
  check('口径行数 = 6', out.children.length === 6);
}

// ── 33. 异常状态伤害单位是 /层/秒（D-038）──
{
  const txt = registry['#dot-detail'].textContent;
  if (txt && !txt.includes('无持续伤害')) {
    check('异常状态伤害值单位含 /层/秒', txt.includes('/层/秒'));
  } else {
    check('异常状态伤害值单位含 /层/秒（本轮无 DoT，跳过）', true);
  }
}

// ── 34. 暴击变动用 % 而不是 pp（D-039）──
{
  const card = registry['#candidate-list'].children.find((c) => c.textContent.includes('致命一击'))
    ?? registry['#candidate-list'].children[0];
  if (card) {
    card.fire('click');
    check('暴击变动不再用 pp', !registry['#detail'].textContent.includes(' pp'));
  }
}

// ── 35. 毒气每层秒伤不为 0（D-039 / D-107）──
{
  const txt = registry['#dot-detail'].textContent;
  check('异常状态伤害带 /层/秒 单位', txt.includes('/层/秒'));

  // D-107：直接对数值断言，不从界面文本反查。
  //   ① 火+毒能合成毒气，且毒气每层秒伤 > 0；
  //   ② 火焰 % 不给毒气加成（毒气只吃"毒气自己的 %"）。
  //
  // ⚠ 这里用**桩武器**而不是页面当前武器：这一节可能跑在"清空配装"之后，
  //   页面状态不是稳定的起点；桩武器只依赖 core，断言不会随界面步骤漂移。
  const { compute } = modules.core;
  const w = {
    id: 'StubRifle', name: 'Stub',
    critChance: 0, critMultiplier: 2, statusChance: 0.5,
    fireRate: 10, magazineSize: 30, reloadTime: 2,
    modes: [{
      id: 'primary', role: 'normal', trigger: 'auto', multishot: 1,
      variants: [{
        id: 'direct', label: '直接命中',
        segments: [{ kind: 'physical', procChance: 0.5, damage: { impact: 100 } }],
      }],
    }],
  };
  const mode = w.modes[0];
  const noOpts = { faction: 'none', headshot: { enabled: false, multiplier: 3 } };
  const gasOnly = [
    { stat: 'elemental:heat', form: 'pct', amount: 90, source: 'hellfire' },
    { stat: 'elemental:toxin', form: 'pct', amount: 90, source: 'infected' },
  ];
  const segGas = compute(w, mode, gasOnly, noOpts, false).segments[0];
  const gasTick = segGas.dotTicks.find((d) => d.type === 'gas');
  check('火+毒合成毒气后每层秒伤 > 0', Boolean(gasTick) && gasTick.tick > 0);
  check('毒气不吃火焰%（火焰 % 只作用于火焰那一份）', Boolean(gasTick) && gasTick.elementPct === 0);
  void txt;
  void store;
}

// ── 3. 当前面板 / 伤害分布 的变化高亮（D-041 / D-045 回归）──
{
  recoverFullSlots();
  const hasChanged = (items) =>
    items.some((row) => row.children.some((c) => (c.className || '').includes('changed')));
  check('武器面板有变化高亮', hasChanged(registry['#panel-table'].children));
  check('伤害分布有变化高亮', hasChanged(registry['#damage-table'].children));

  const highlightColumns = (sel) => {
    const cols = new Set();
    for (const row of registry[sel].children) {
      row.children.forEach((c, i) => {
        if ((c.className || '').includes('changed')) cols.add(i);
      });
    }
    return cols;
  };
  const pc = highlightColumns('#panel-table');
  check('武器面板只在「当前」列高亮', pc.size === 1 && pc.has(2));
  const dc = highlightColumns('#damage-table');
  check('伤害分布只在「当前」列高亮', dc.size === 1 && dc.has(2));

  const totalRow = registry['#damage-table'].children.find((r) => r.textContent.includes('合计'));
  check('合计行不高亮', totalRow && !totalRow.children.some((c) => (c.className || '').includes('changed')));
}

// ── 40. 不再显示"可装 N 张"；按钮有样式类（D-041）──
{
  check('不显示可装张数', !registry['#slot-info'].textContent.includes('可装'));
  check('「全部卸下」按钮带 btn-ghost 样式类',
    /id="unequip-all"[^>]*class="btn-ghost"|class="btn-ghost"[^>]*id="unequip-all"/.test(html));
  const css = await readFile(join(ROOT, 'packages/demo/public/app.css'), 'utf8');
  check('CSS 里有 .btn-ghost 样式', css.includes('.btn-ghost'));
}

// ── 41. 增幅基准与备选筛选同样式（D-042）──
{
  const mbox = registry['#metric-options'];
  check('增幅基准用按钮', mbox.children.length === 6 && mbox.children.every((b) => b.tagName === 'BUTTON'));
  check('增幅基准有 filter-btn 样式类', mbox.children.every((b) => (b.className || '').includes('filter-btn')));
  check('增幅基准当前项高亮', mbox.children.filter((b) => (b.className || '').includes('active')).length === 1);
}

// ── 42. 非玄骸武器隐藏玄骸加成（D-042）──
//
// ⚠ 断言必须跟随**当前默认武器**（2026-11-06 起是步枪第一把，非玄骸）：
//   之前写死了"玄骸武器显示玄骸加成"，换默认武器后会假红/假绿。
{
  const kuva = Boolean(store.store.data && store.store.data.isKuva);
  const shown = registry['#kuva-controls'].style.display !== 'none';
  check('玄骸武器才显示玄骸加成（当前武器 isKuva=' + kuva + '）', shown === kuva);
  check('代码里用 isKuvaFamily 判断玄骸系', appSrc.includes('isKuvaFamily'));
  check('非玄骸时隐藏标题与控件', appSrc.includes('renderKuvaVisibility'));
}

// ── 43. 多面板武器模式切换栏（D-042）──
{
  const box = registry['#mode-switch'];
  const modes = store.store.data.weapon.modes.length;
  check('有模式切换容器', Boolean(box));
  // 单模式武器不显示按钮；多模式（如两形态）要有按钮 —— 随默认武器走
  check('模式按钮数 = 模式数 - 1（当前 ' + modes + ' 个模式）',
    box.children.length === Math.max(0, modes - 1));
  check('模式切换栏在武器面板标题右侧',
    html.indexOf('id="mode-switch"') > 0 && html.indexOf('id="mode-switch"') < html.indexOf('id="panel-table"'));
}

// ── 44. 武器切换选单：选中值必须等于当前武器（D-097）──
{
  const gsel = registry['#weapon-group'];
  const tsel = registry['#weapon-type'];
  const wsel = registry['#weapon-select'];
  check('有武器大类选单', Boolean(gsel));
  check('有武器类型选单', Boolean(tsel));
  check('有武器名选单', Boolean(wsel));
  // D-119：四个大类全部开放，不再有禁用项
  check('四个大类都可选（D-119）',
    Array.from(gsel.children).length === 4 && Array.from(gsel.children).every((o) => o.disabled !== true));

  const beforeType = tsel.value;
  const other = Array.from(tsel.children).find((o) => o.value !== beforeType);
  check('类型选单里不止一个类型', Boolean(other));
  if (other) {
    tsel.value = other.value;
    tsel.fire('change');
    await new Promise((r) => setTimeout(r, 200));
    check('切换类型后武器选单已更新', wsel.children.length > 0);
  }

  tsel.value = beforeType;
  tsel.fire('change');
  await new Promise((r) => setTimeout(r, 200));
  const typeOpts = Array.from(wsel.children).map((o) => o.value);
  check('切回类型后选单有选中项', Boolean(wsel.value));
  check('切回类型后选中项存在于列表', typeOpts.includes(wsel.value));

  const steady = wsel.value;
  wsel.fire('change');
  await new Promise((r) => setTimeout(r, 200));
  check('重复选中当前武器不出错', wsel.value === steady);

  const search = registry['#weapon-search'];
  check('有搜索框', Boolean(search));
  if (search) {
    const curId = wsel.value;
    search.value = '血肢';
    search.fire('input');
    await new Promise((r) => setTimeout(r, 200));
    const opts = Array.from(wsel.children).map((o) => o.value);
    check('搜索结果里含血肢', opts.some((v) => /Hema/i.test(v)));
    check('搜索时补了"当前武器"项', opts.includes(curId));
    check('搜索时选中值仍是当前武器', wsel.value === curId);

    search.value = '';
    search.fire('input');
    await new Promise((r) => setTimeout(r, 200));
    check('清空搜索后选中值仍是当前武器', wsel.value === curId);
  }
}

// ── 45. 弹道筛选（D-099 A）──
{
  const ssel = registry['#weapon-style'];
  check('有弹道下拉栏', Boolean(ssel));
  if (ssel) {
    check('弹道选项 = 6 项', ssel.children.length === 6);
    const labels = Array.from(ssel.children).map((o) => o.textContent);
    check('含全自动/半自动/点射/蓄力', ['全自动', '半自动', '点射', '蓄力'].every((x) => labels.includes(x)));

    const wsel = registry['#weapon-select'];
    const allCount = wsel.children.length;
    ssel.value = 'semi';
    ssel.fire('change');
    await new Promise((r) => setTimeout(r, 200));
    check('筛半自动后选项变少', wsel.children.length > 0 && wsel.children.length <= allCount);

    ssel.value = 'all';
    ssel.fire('change');
    await new Promise((r) => setTimeout(r, 200));
    check('切回全部弹道后选项恢复', wsel.children.length === allCount);
  }
}

// ── 46. 数据问题标记（D-101）──
{
  const wsel = registry['#weapon-select'];
  const withMark = Array.from(wsel.children).filter((o) => o.textContent.includes('\u26a0'));
  check('武器选单里有带标记的项', withMark.length > 0);
  if (withMark.length) {
    check('带标记的项有 title 说明', Boolean(withMark[0].title));
    const ignis = Array.from(wsel.children).find((o) => /FlameThrower(?!Wraith)/.test(o.value));
    if (ignis) check('伊格尼斯带标记', ignis.textContent.includes('\u26a0'));
  }
  check('issuesOf 对已知问题武器返回非空', issuesMod.issuesOf('FlameThrower').length > 0);
  check('issuesOf 对正常武器返回空', issuesMod.issuesOf('KuvaKarak').length === 0);

  // D-111：灵化面板复用基础面板的情况并进同一套问题清单（不再单独做一套标记）
  const incReused = issuesMod.issuesOf('BratonPrime');
  check('灵化面板复用 → 走 D-101 的问题清单',
    incReused.some((x) => x.code === 'incarnonPanelReused'));
  check('灵化面板复用的说明写清"复用基础面板"',
    incReused.some((x) => x.note.includes('复用基础面板')));
  check('已录入灵化数值的武器不再标记问题',
    issuesMod.issuesOf('ZarimanHeavyPistol').every((x) => x.code !== 'incarnonPanelReused'));
}

// ── 47. 重启页面：选单 / 槽位 / 输出全部可从零重建 ──
//
// 不少渲染路径是"先清空再填"，只在首次加载时跑不到；这里模拟一次刷新，
// 防止「第二次启动少渲染一块」这类回归。
{
  const beforeSel = registry['#weapon-select'].value;
  const beforeSlots = slotTexts().length;
  const beforeOut = registry['#output-list'].children.length;
  await invokeBoot();
  await new Promise((r) => setTimeout(r, 300));
  check('重启后武器选单仍有选中项', Boolean(registry['#weapon-select'].value));
  check('重启后武器选单选中同一把（' + beforeSel + '）', registry['#weapon-select'].value === beforeSel);
  check('重启后 Mod 槽位仍然渲染', slotTexts().length === beforeSlots);
  check('重启后输出口径仍然渲染', registry['#output-list'].children.length === beforeOut);
  check('重启后备选区仍然有卡', registry['#candidate-list'].children.length > 50);
}

// ── 48. 镀层加成框始终显示、可编辑；推演小字改到镀层 Mod 卡上（D-112 / D-117）──
//
// 页面默认不预装 Mod（D-052），所以首次加载就是"没上镀层基伤 Mod"的状态：
//   · 这个框仍要显示；
//   · 叠加层数**可编辑**，默认取该项的最大值；
//   · D-117（需求方 2026-11-06）：「镀层加成那边的小字推演去掉，这应该是放到镀层 mod 本身上显示的」
//     → 配置区不再有推演/公式小字；收益显示在备选区的镀层卡上。
{
  await invokeBoot();
  await new Promise((r) => setTimeout(r, 300));
  const box = registry['#co-controls'];
  const co = modules.compute.coInfo();
  check('没装镀层 Mod 时仍显示「镀层加成」标题', box.textContent.includes('镀层加成'));
  check('没装镀层 Mod 时仍显示「敌人异况层数」输入框', box.textContent.includes('敌人异况层数'));
  const selectOf = (function findSel(n) {
    if (n.tagName === 'SELECT') return n;
    for (const c of n.children ?? []) { const hit = findSel(c); if (hit) return hit; }
    return null;
  })(box);
  const ySel = selectOf;
  check('没装镀层 Mod 时也渲染「叠加层数」下拉', Boolean(ySel));
  check('没装镀层 Mod 时「叠加层数」下拉可编辑（未置灰）', Boolean(ySel) && ySel.disabled !== true);
  check('「叠加层数」默认值是最大值（' + (ySel && ySel.value) + '/' + co.maxStacks + '）',
    Boolean(ySel) && Number(ySel.value) === co.maxStacks && co.maxStacks >= 2);
  check('coInfo 用「假设装备」推演（preview = true）', co.active === false && co.preview === true);
  // D-117：小字推演全部去掉
  const muted = [];
  (function collectMuted(n) {
    if ((n.className || '').includes('muted')) muted.push(n.textContent);
    for (const c of n.children ?? []) collectMuted(c);
  })(box);
  check('配置区不再有「假设装备」推演小字', !box.textContent.includes('假设装备'));
  check('配置区不再有「每层 x% × 异况 × 层」公式小字', !/每层\s*[\d.]+\s*%\s*×/.test(muted.join('|')));
  check('真实计算不受推演影响（computeOptions 不传 coStacks）',
    modules.compute.computeOptions().coStacks === undefined);
}

// ── 49. 启动时的默认武器 = 主要 → 步枪的第一把（需求方 2026-11-06）──
{
  await invokeBoot();
  await new Promise((r) => setTimeout(r, 400));
  const st = store.store; // 命名空间里的真实状态对象
  const group = st.dataAll.groups.get('primary');
  const rifle = group.types.get('rifle');
  check('有步枪分类且非空', Boolean(rifle) && rifle.weapons.length > 0);
  check('默认武器是步枪的第一把（' + st.data.weapon.id + '）',
    Boolean(rifle) && st.data.weapon.id === rifle.weapons[0].id);
  check('默认武器不再是卡拉克', !/KuvaKarak/.test(st.data.weapon.id));
  check('类型下拉停在步枪', registry['#weapon-type'].value === 'rifle');
  check('武器下拉选中的就是正在算的那把（D-097）',
    registry['#weapon-select'].value === st.data.weapon.id);
}

rec.finish();
