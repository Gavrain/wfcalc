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

// 测试自己产生的「上次武器」会跨用例残留（同一个进程内 localStorage 是内存版），
// 所以每个脚本开头先清掉，保证从默认武器开始。
if (typeof localStorage !== 'undefined') localStorage.clear();
const { registry, modules } = await loadPage({ waitMs: 400 });
const store = modules.store;
const rec = createChecks('interact');
const check = rec.check.bind(rec);

// ── helpers ──
const grid = () => registry['#slot-grid'].children;
const slotTexts = () => grid().map((c) => c.textContent);
const findCard = (name) => registry['#candidate-list'].children.find((c) => c.textContent.includes(name));
const outText = () => registry['#output-list'].children.map((c) => c.textContent).join('|');
/** 在子树里数带某个 class 的节点 */
function countByClass(node, cls) {
  let n = 0;
  for (const c of node.children ?? []) {
    if ((c.className || '').split(/\s+/).includes(cls)) n++;
    n += countByClass(c, cls);
  }
  return n;
}

/** 在子树里数「模式按钮」（`.mode-btn` 但**不是** `.variant-btn`——攻击方式胶囊共用同一个样式类） */
function countModeButtons(node) {
  let n = 0;
  for (const c of node.children ?? []) {
    const classes = (c.className || '').split(/\s+/);
    if (classes.includes('mode-btn') && !classes.includes('variant-btn')) n++;
    // `.mode-row` 是外层唯一容器；攻击方式胶囊在它下面但带 `.variant-btn`，不会被数进来。
    // ⚠ 钻进 `.variant-btn` 自己会数到它里的按钮（`<label class="mode-btn variant-btn">`），
    //   单模式武器就多算一个 —— 这里显式跳过以防 shim/浏览器节点结构变化。
    if (classes.includes('variant-btn')) continue;
    n += countModeButtons(c);
  }
  return n;
}

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

// ── 15. 口径命名与单位（D-033；2026-11-12 统一改名）──
{
  const out = registry['#output-list'];
  const text = out.textContent;
  check('口径含「单弹头」且标 /弹头', text.includes('单弹头') && text.includes('/弹头'));
  check('口径含「单次射击」且标 /发', text.includes('单次射击') && text.includes('/发'));
  check('「每秒命中」已改名「连发秒伤」', text.includes('连发秒伤') && !text.includes('每秒命中'));
  check('「持续伤害」已改名「续航秒伤」', text.includes('续航秒伤') && !text.includes('持续伤害'));
  check('DoT 改为「异常加权单层秒伤」与「六秒异常总伤」（D-057/D-060）',
    text.includes('异常加权单层秒伤') && text.includes('6秒异常总伤'));
  check('旧名「DoT 六秒总伤」已不存在', !text.includes('DoT 六秒总伤'));
  check('旧名「DoT 加权每层秒伤」已不存在', !text.includes('DoT 加权每层秒伤'));
  check('口径行数 = 8', out.children.length === 8);
}

// ── 33. 异常状态伤害单位是 /层/秒（D-038）──
//
// ⚠ 断言必须跟随**当前默认武器**：它们一换（2026-11-12 起默认是同伴枪 Gremlin / 阿塔克斯 ——
//   需求方确认守护武器并入主要大类后它排到了步枪第一把），这轮可能就是纯冰的「非伤害型异常」。
//   那种情况下本来就没有"伤害值/层"可言，按"跳过"记，不能算失败。
{
  const txt = registry['#dot-detail'].textContent;
  const noDot = !txt || txt.includes('无持续伤害') || txt.includes('▸非伤害型异常');
  if (!noDot) {
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
  // 与上面第 33 节同理：默认武器可能不带伤害型异常（纯冰的同伴枪），此时不判单位
  const noDot = !txt || txt.includes('无持续伤害') || txt.includes('▸非伤害型异常');
  check('异常状态伤害带 /层/秒 单位', noDot || txt.includes('/层/秒'), txt.slice(0, 80));

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

  // ⚠ 需求方 2026-11-12：「不同段的伤害分布是不一样的，为什么没有多个伤害分布表」。
  //   所以 `#damage-table` 现在是**容器**：里面每种攻击方式一个 `.dmg-table`，
  //   勾选多种时最后再加一张「合计」表。这里把每一张表的行摊平再检查高亮。
  const dmgTables = registry['#damage-table'].children.filter((n) =>
    (n.className || '').includes('dmg-table'));
  check('伤害分布至少有一张表', dmgTables.length > 0, `${dmgTables.length} 张`);
  const dmgRows = dmgTables.flatMap((t) => (t.children[0] ? t.children[0].children : []));
  check('伤害分布有变化高亮', hasChanged(dmgRows));

  const highlightColumns = (rows) => {
    const cols = new Set();
    for (const row of rows) {
      row.children.forEach((c, i) => {
        if ((c.className || '').includes('changed')) cols.add(i);
      });
    }
    return cols;
  };
  const pc = highlightColumns(registry['#panel-table'].children);
  check('武器面板只在「当前」列高亮', pc.size === 1 && pc.has(2));
  const dc = highlightColumns(dmgRows);
  check('伤害分布只在「当前」列高亮', dc.size === 1 && dc.has(2));

  // 每张表末尾各有一行「合计」（该攻击方式自己的和）；它不该高亮。
  // ⚠ 需求方 2026-11-12：「不需要合计啊，而且他们的触发是各自算的」——
  //   所以不再有**跨攻击方式的合计表**，每张表自己的合计行仍然保留。
  const perTableTotal = dmgTables.map((t) =>
    (t.children[0] ? t.children[0].children : []).find((r) => r.textContent.includes('合计')));
  check('合计行不高亮',
    perTableTotal.every((row) => row && !row.children.some((c) => (c.className || '').includes('changed'))));
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
  check('增幅基准用按钮', mbox.children.length === 8 && mbox.children.every((b) => b.tagName === 'BUTTON'));
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
  // 单模式武器不显示按钮；多模式（如两形态）要有按钮 —— 随默认武器走。
  // ⚠ 2026-11-12 界面把「模式」与「攻击方式」做成同一种胶囊排在同一行 `.mode-row`：
  //   容器里现在是一个 `.mode-row`，里面才是按钮。所以按 **`.mode-row` 的按钮数** 断言。
  const row = box.children.find((c) => (c.className || '').split(/\s+/).includes('mode-row'));
  const isModeBtn = (node) => {
    const cls = (node.className || '').split(/\s+/);
    return cls.includes('mode-btn') && !cls.includes('variant-btn');
  };
  const btnCount = row ? row.children.filter(isModeBtn).length : 0;
  // 模式栏渲染了 `.mode-row`、里面放着模式按钮（单模式时只有「普攻」一个按钮 + 攻击方式胶囊）
  // ⚠ 别在这里断言「按钮数 = 模式数 - 1」：当前默认武器是单模式的守护枪，断言值会退化，
  //   而多模式武器的按钮数由 44 节「切类型 / 切模式」与 mode-panel.mjs 覆盖。
  check('模式栏渲染出 .mode-row 与模式按钮', Boolean(row) && btnCount >= 1, ', ' + btnCount + ' 个');
  check('单模式武器也会显示一行「攻击方式」提示', !(modes <= 1) || box.children.length > 0);
  // 需求方 2026-11-12：按钮独立成行、在「武器面板」标题**上方**且靠左（否则切换时跳动）
  const iSwitch = html.indexOf('id="mode-switch"');
  const iTitle = html.indexOf('>武器面板<');
  const cssHead = await readFile(join(ROOT, 'packages/demo/public/app.css'), 'utf8');
  check('模式切换栏在「武器面板」标题上方（独立一行）',
    iSwitch > 0 && iTitle > iSwitch && html.indexOf('id="panel-table"') > iTitle);
  check('模式切换栏所在行靠左（容器 justify-content: flex-start）',
    /\.mode-row-slot\s*\{[^}]*justify-content:\s*flex-start/.test(cssHead));
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
  const panel = registry['#weapon-search-panel'];
  check('有搜索框', Boolean(search));
  check('有搜索结果显示面板', Boolean(panel));
  if (search && panel) {
    // D-151（需求方 2026-11-13）：「应该是搜索框下面列出结果，就像搜索引擎那样。
    // 现在变成输入以后筛选了，这不对。」→ 打字只画面板，下拉框一个字都不动。
    const curId = wsel.value;
    const curGroup = gsel.value;
    const curType = tsel.value;
    const curChildren = wsel.children.length;
    search.value = '血肢';
    search.fire('input');
    await new Promise((r) => setTimeout(r, 200));
    const items = panel.children.filter((c) => c.className === 'search-item');
    check('搜索后面板打开', panel.hidden !== true);
    check('搜索后面板列出结果', items.length > 0, items.map((c) => c.className).join(','));
    check('结果面板含血肢', items.some((c) => /Hema|血肢/i.test(JSON.stringify(c.dataset) + c.textContent)));
    check('结果行标了 类型 · 大类', items.some((c) => /·/.test(c.textContent)));
    check('搜索时下拉框一个选项都没变', wsel.children.length === curChildren);
    check('搜索时选中值仍是当前武器', wsel.value === curId);
    check('搜索时大类/类型下拉不动', gsel.value === curGroup && tsel.value === curType);
    check('结果面板在浏览器里挂载在搜索框的容器内',
      /class="search-box"[\s\S]{0,200}id="weapon-search-panel"/.test(html));

    // 点一条结果 → 切枪、清空搜索框、收起面板
    const pick = items.find((c) => /Hema|血肢/i.test(JSON.stringify(c.dataset) + c.textContent));
    if (pick) {
      pick.fire('click');
      await new Promise((r) => setTimeout(r, 400));
      check('点选结果后切到该武器', String(store.store.data && store.store.data.weapon && store.store.data.weapon.id) === pick.dataset.weaponId);
      check('点选后搜索框清空', search.value === '');
      check('点选后面板收起', panel.hidden === true);
      check('点选后武器下拉选中该项', wsel.value === pick.dataset.weaponId);
    }

    // 搜不到 → 收起
    search.value = 'zzzz不存在zzzz';
    search.fire('input');
    await new Promise((r) => setTimeout(r, 100));
    check('搜不到时面板收起', panel.hidden === true);

    search.value = '';
    search.fire('input');
    await new Promise((r) => setTimeout(r, 200));
    check('清空搜索后面板收起', panel.hidden === true);
  }
}

// ── 44b. 搜索跨大类（D-151）──
//
// 需求方选了方案 A：搜全部四类；点哪把，大类/类型下拉跟过去。
// 用「血肢」→ 选中「终幕·血肢(CodaHema)」验证不了跨类，所以这里搜「希尔德」：
// 它是近战（primary 分类下的下拉栏里搜不到），能把"跨大类跳转"整条路径走一遍。
{
  const gsel = registry['#weapon-group'];
  const tsel = registry['#weapon-type'];
  const wsel = registry['#weapon-select'];
  const search = registry['#weapon-search'];
  const panel = registry['#weapon-search-panel'];
  if (search && panel && gsel) {
    gsel.value = 'primary';
    tsel.fire('change');
    await new Promise((r) => setTimeout(r, 200));
    search.value = '赤毒·希尔德';
    search.fire('input');
    await new Promise((r) => setTimeout(r, 200));
    const items = panel.children.filter((c) => c.className === 'search-item');
    check('在主要分类下能搜出近战武器', items.length > 0, items.map((c) => c.textContent).join(' / '));
    const pick = items.find((c) => c.dataset.weaponId === 'GrnKuvaLichScytheWeapon');
    check('搜索结果里能找到赤毒·希尔德', Boolean(pick));
    if (pick) {
      pick.fire('click');
      await new Promise((r) => setTimeout(r, 400));
      check('跨大类点选后切到该武器', String(store.store.data && store.store.data.weapon && store.store.data.weapon.id) === pick.dataset.weaponId);
      check('跨大类点选后大类下拉跟过去', gsel.value === 'melee');
      check('跨大类点选后武器下拉选中该项', wsel.value === pick.dataset.weaponId);
      // 赤毒·希尔德属于 近战 → 锤（`weapon-slots.json` 的 specific = hammer，巨镰才是 heavy_scythe）
      check('跨大类点选后类型下拉跟到该武器所在类型', tsel.value === 'hammer');
    }
    search.value = '';
    search.fire('input');
    await new Promise((r) => setTimeout(r, 100));
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

// ── 46. 数据错误标记已移除（需求方 2026-11-12）──
//
// 原话：「现在应该不需要错误标记了，所有面板转到 wfcd 已经修正了，清除掉。」
// 所以这里反过来验证：选单里**不该**再出现 ⚠。
{
  const wsel = registry['#weapon-select'];
  const withMark = Array.from(wsel.children).filter((o) => o.textContent.includes('\u26a0'));
  check('武器选单里没有 ⚠ 错误标记', withMark.length === 0,
    withMark.slice(0, 3).map((o) => o.textContent).join(' / '));
  const titleEl = registry['#weapon-title'];
  check('武器标题没有 ⚠ 错误标记', !String(titleEl.textContent).includes('\u26a0'), titleEl.textContent);
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
  // 这一段的语义是「首次加载、没装任何 Mod」时的状态，
  // 所以同样要先清存档再重启，否则会带着前面用例装过的镀层卡。
  if (typeof localStorage !== 'undefined') localStorage.clear();
  await invokeBoot();
  await new Promise((r) => setTimeout(r, 300));
  const box = registry['#co-controls'];
  const co = modules.compute.coInfo();
  // 需求方 2026-11-12：「镀层加成要变成配置的次级」→ 它不再是独立标题块，
  // 改成小标签「镀层」，和派系、爆头排在同一组控件里（见 D-158）。
  check('没装镀层 Mod 时仍显示「镀层」小标签', box.textContent.includes('镀层'));
  check('镀层控件排在派系之后、同属配置区', html.indexOf('id="faction-select"') < html.indexOf('id="co-controls"'));
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
  // 这是「从零启动」的用例：前面各段换过枪，存档里记着「上次是哪把」，
  // 不清掉的话重启会按 D-157 回到上次那把 —— 这里要测的是没存档时的默认值。
  if (typeof localStorage !== 'undefined') localStorage.clear();
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

// ── 50. 守护 / 同伴武器（需求方 2026-11-12）──
//
// 原话：「搜不到守护武器，例如冰凇」→ 数据早就生成了，但 `app-data.js` 的 `WEAPON_FILES`
// 没加载 `companion.json`，24 把同伴武器从没进过界面。口径（需求方确认）：
//   · **不单列大类**，按槽位宽类并入「主要」（步枪 / 霰弹）与「近战」；
//   · 扫除者两把是霰弹枪、分离与猎犬三爪是近战、其余枪械是步枪；
//   · 守护 / 同伴武器**一律不可装赋能**（分离虽是近战也不行）。
{
  await invokeBoot();
  await new Promise((r) => setTimeout(r, 300));
  const st = store.store;
  const gsel = registry['#weapon-group'];
  const tsel = registry['#weapon-type'];
  const wsel = registry['#weapon-select'];
  const search = registry['#weapon-search'];
  const panel = registry['#weapon-search-panel'];

  // ① 数据已经加载
  for (const id of ['SentinelFreezeRayRifle', 'SentinelFreezeRayPrimeRifle', 'SentShotgun', 'SentGlaiveWeapon']) {
    check('同伴武器已加载：' + id, Boolean(st.dataAll.weaponById.get(id)));
  }

  // ② 搜索能搜到并切过去（用户报的原始问题）
  if (search && panel) {
    const hitsAt = async (kw) => {
      search.value = kw;
      search.fire('input');
      await new Promise((r) => setTimeout(r, 200));
      return panel.children.filter((c) => c.className === 'search-item');
    };
    const hits = await hitsAt('冰凇');
    check('搜「冰凇」有结果', hits.length > 0, hits.map((c) => c.textContent).join(' / '));
    check('搜「冰凇」结果是冰凇 / 冰凇 Prime',
      hits.every((c) => /^SentinelFreezeRay(Prime)?Rifle$/.test(c.dataset.weaponId)) && hits.length === 2,
      hits.map((c) => c.dataset.weaponId).join(','));
    check('结果行标注「步枪 · 主要」',
      hits.some((c) => c.textContent.includes('步枪') && c.textContent.includes('主要')));

    const pick = hits.find((c) => c.dataset.weaponId === 'SentinelFreezeRayRifle');
    if (pick) {
      pick.fire('click');
      await new Promise((r) => setTimeout(r, 400));
      check('点选冰凇后切到该武器', st.data && st.data.weapon.id === 'SentinelFreezeRayRifle');
      check('点选冰凇后大类落在「主要」', gsel.value === 'primary');
      check('点选冰凇后类型落在步枪', tsel.value === 'rifle');
      check('点选冰凇后武器下拉选中它', wsel.value === 'SentinelFreezeRayRifle');
      check('冰凇能装步枪 Mod（有备选卡）', registry['#candidate-list'].children.length > 0);
      check('冰凇的赋能槽置灰', arcanesDisabledNow());
      check('冰凇的右侧赋能区收起', registry['#arcane-area'].hidden === true);
      check('冰凇状态里没有可用赋能',
        Array.isArray(st.data.primaryArcanes) && st.data.primaryArcanes.length === 0);
    }

    // ③ 霰弹：扫除者进「主要 → 霰弹枪」
    const shotgun = await hitsAt('扫除者');
    check('搜「扫除者」有结果', shotgun.length > 0);
    check('扫除者标注「霰弹枪 · 主要」', shotgun.some((c) => c.textContent.includes('霰弹枪')));
    search.value = '';
    search.fire('input');
    await new Promise((r) => setTimeout(r, 100));
  }

  // ④ 近战：分离 / 猎犬三爪在「近战」大类里能找到
  gsel.value = 'melee';
  tsel.fire('change');
  await new Promise((r) => setTimeout(r, 200));
  const meleeIds = [];
  for (const bucket of st.dataAll.groups.get('melee').types.values()) {
    for (const w of bucket.weapons) meleeIds.push(w.id);
  }
  for (const id of ['SentGlaiveWeapon', 'PrimeHeliosGlaiveWeapon', 'ZanukaPetMeleeWeaponIP', 'ZanukaPetMeleeWeaponIS', 'ZanukaPetMeleeWeaponPS']) {
    check('近战大类里有 ' + id, meleeIds.includes(id));
  }

  // ⑤ 分离 = 近战，可装近战 Mod，但赋能同样禁用
  //    换枪走**搜索 + 点选**这条真实路径（app.js 的 `switchWeapon` 是模块私有函数，外部拿不到）
  if (search && panel) {
    search.value = '分离';
    search.fire('input');
    await new Promise((r) => setTimeout(r, 200));
    const diss = panel.children.filter((c) => c.className === 'search-item');
    check('搜「分离」有结果', diss.length > 0, diss.map((c) => c.textContent).join(' / '));
    check('「分离」结果里有分离 / 分离 Prime',
      diss.some((c) => c.dataset.weaponId === 'SentGlaiveWeapon') && diss.some((c) => c.dataset.weaponId === 'PrimeHeliosGlaiveWeapon'));
    const pickDiss = diss.find((c) => c.dataset.weaponId === 'SentGlaiveWeapon');
    if (pickDiss) {
      pickDiss.fire('click');
      await new Promise((r) => setTimeout(r, 400));
      check('切到分离', st.data && st.data.weapon.id === 'SentGlaiveWeapon');
      check('分离的大类落在「近战」', gsel.value === 'melee');
      check('分离可装近战 Mod', (st.data.availableMods || []).some((m) => m.slotKind === 'melee'));
      check('分离的赋能槽同样置灰', arcanesDisabledNow());
      check('分离没有可用赋能', (st.data.primaryArcanes || []).length === 0);
    }

    // ⑥ 普通武器不受影响：切回一把步枪，赋能区恢复
    //    ⚠ 必须用**非玄骸**的枪：默认的 Gremlin 是玄骸系，会被玄骸元素解算拦一把，
    //      换枪后的赋能区刷新就没机会跑（这不是本功能的问题）。
    search.value = '布莱顿';
    search.fire('input');
    await new Promise((r) => setTimeout(r, 200));
    const normal = panel.children.filter((c) => c.className === 'search-item');
    const pickNormal = normal.find((c) => c.dataset.weaponId === 'Rifle');
    check('搜「布莱顿」能搜到 Braton', Boolean(pickNormal));
    if (pickNormal) {
      pickNormal.fire('click');
      await new Promise((r) => setTimeout(r, 400));
    }
    search.value = '';
    search.fire('input');
    await new Promise((r) => setTimeout(r, 100));
  }
  check('切回布拉通后当前武器是 Braton', st.data && st.data.weapon.id === 'Rifle');
  check('切回普通步枪后赋能槽没有置灰', !arcanesDisabledNow());
  check('切回普通步枪后赋能区重新显示', registry['#arcane-area'].hidden !== true);
  check('普通步枪有可用赋能', (st.data.primaryArcanes || []).length > 0);
}

/** 当前武器是否处于"不可装赋能"状态（读渲染结果，不是读实现） */
function arcanesDisabledNow() {
  const card = registry['#arcane-slots'].children[0];
  if (!card) return false;
  const body = card.children.find((c) => (c.className || '').includes('slot-body'));
  const txt = body ? body.textContent : card.textContent;
  return (card.className || '').includes('disabled') || txt.includes('不可装赋能');
}

rec.finish();
