/**
 * 配置区与备选 Mod 区的界面规则（D-026 ~ D-040），从 interact 里拆出来。
 *
 *   node packages/demo/src/checks/mode-status.mjs
 *
 * 覆盖：槽位拖拽语义（D-034/035/038/040）、筛选与搜索（D-029/035/037/040）、
 * 玄骸元素与玄骸滑条（D-026/034）、爆头开关（D-027）、用语与口径命名（D-028/033）。
 */
import { findDeep, collect } from '../dom/shim.mjs';
import { createChecks } from '../dom/report.mjs';
import { loadPage } from '../dom/load-page.mjs';

const { registry, html } = await loadPage({ waitMs: 400 });
const rec = createChecks('mode-status');
const check = rec.check.bind(rec);

const grid = () => registry['#slot-grid'].children;
const slotTexts = () => grid().map((c) => c.textContent);
const findCard = (name) => registry['#candidate-list'].children.find((c) => c.textContent.includes(name));
const outText = () => registry['#output-list'].children.map((c) => c.textContent).join('|');
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
/** 备选卡上的 Mod 名（取 cand-top 里的名字，避开「增幅 +x%」等文字） */
function candName(card) {
  if (!card) return null;
  const top = card.children.find((x) => (x.className || '').indexOf('cand-top') >= 0);
  return top ? top.children[0].textContent : null;
}
const candNameList = () => registry['#candidate-list'].children.map(candName).filter(Boolean);
/**
 * 备选卡的「功能」标签挂在 **cand-top** 里（不是 card 的直接子节点），
 * 所以要用 collect 往下收集，不能只看 `c.children`。
 */
function hasExilusTag(card) {
  return collect(card, 'tag').some((n) => n.textContent === '功能');
}
function dragOutSlot(i) {
  const card = grid()[i];
  card.fire('dragstart');
  card.fire('dragend');
}
function recoverFullSlots() {
  const names = ['膛线', '分裂膛室', '致命一击', '弱点感应', '地狱火', '污染弹匣', '私法 军备', '重口径'];
  for (let i = 0; i < grid().length; i++) dragOutSlot(i);
  for (let i = 0; i < names.length; i++) {
    let card = null;
    for (const c of registry['#candidate-list'].children) {
      const top = c.children.find((x) => (x.className || '').indexOf('cand-top') >= 0);
      if (top && top.children[0].textContent === names[i]) { card = c; break; }
    }
    if (card) { card.fire('dragstart'); grid()[i].fire('drop'); }
  }
}
// ── 1. 基础渲染 ──
check('8 个 Mod 槽位', grid().length === 8);
check('默认不预装 Mod（8 槽全空）', slotTexts().filter((t) => !t.includes('空')).length === 0);
check('默认劣化槽为空', !slotTexts()[8] || slotTexts()[8].includes('空') || slotTexts().length <= 8);
check('备选区已渲染', registry['#candidate-list'].children.length > 50);

// ── 2. 用语检查（D-028-1 / -4）──
{
  const panelHead = registry['#panel-table'].children[0].textContent;
  check('面板列名是「当前面板」', panelHead.includes('当前面板'));
  check('面板列名不再出现「Mod 后」', !panelHead.includes('Mod 后'));
  const factionOpts = registry['#faction-select'].children.map((o) => o.textContent);
  check('派系里没有中文名', !factionOpts.some((t) => /[\u4e00-\u9fa5]/.test(t) && t !== '无'));
}

// ── 3. 玄骸元素列表（D-026）──
{
  const opts = registry['#kuva-element'].children.map((o) => o.value);
  const expected = ['cold', 'heat', 'toxin', 'electric', 'magnetic', 'radiation', 'impact'];
  check('玄骸元素 = 冰火毒电磁力辐射冲击', expected.every((e) => opts.includes(e)) && opts.length === 7);
  check('玄骸元素不含穿刺/切割', !opts.includes('puncture') && !opts.includes('slash'));
}

// ── 4. 拖出配置区即卸下（D-040）──
{
  const card = registry['#candidate-list'].children[0];
  card.fire('dragstart');
  grid()[0].fire('drop');
  check('先装上一张 Mod 作为前置', !slotTexts()[0].includes('空'));

  const before = outText();
  check('槽位不再有「卸下」按钮', !findDeep(grid()[0], 'button'));
  check('有「全部卸下」按钮', Boolean(registry['#unequip-all']));
  dragOutSlot(0);
  check('拖出配置区后槽位变空', slotTexts()[0].includes('空'));
  check('卸下后输出变化', outText() !== before);
}

// ── 4b. 拖到已占用槽位 = 互换（D-115，取代 D-038）──
{
  dragOutSlot(1);
  const afterRemove = slotNames().slice();
  check('先制造一个空槽位', afterRemove[1] === null);
  const card = registry['#candidate-list'].children[0];
  const name = candName(card);
  card.fire('dragstart');
  grid()[1].fire('drop');
  check('拖入空槽成功', slotNames()[1] === name);
  check('这张卡已离开备选区', !candNameList().includes(name));
  grid()[1].fire('dragstart');
  grid()[0].fire('drop'); // 槽位 0 已占用 → D-115：互换（原来会被拒绝并卸下）
  check('槽位之间拖到已占用槽 = 互换', slotNames()[0] === name && slotNames()[1] === afterRemove[0]);
  grid()[1].fire('dragstart');
  grid()[1].fire('drop'); // 拖回原位 → 什么都不做
  check('拖回原位不改变配置', slotNames()[0] === name && slotNames()[1] === afterRemove[0]);
}

// ── 4d. 互换后 `gainOf` 不能爆栈（"候选 Mod 清单"缓存必须随槽位变化失效）──
{
  recoverFullSlots();
  const card = registry['#candidate-list'].children.find((c) => !hasExilusTag(c));
  card.fire('dragstart');
  grid()[4].fire('drop'); // 槽位 5 已占用 → 互换
  check('互换后槽位 5 有卡', slotNames()[4] !== null);
  check('互换后渲染没炸（如果爆栈，这一节的执行会直接中断）',
    outText().length > 0 && candNameList().length > 0);
}

// ── 5. 满槽时从备选区拖入 = 互换（D-115 取代 D-034「全满无响应」）──
{
  const before = slotNames();
  check('8 槽已满（前置条件）', before.filter(Boolean).length === 8);
  // 满槽时要测的是**普通 Mod**（功能 Mod 只能进劣化槽，普通槽一律拒绝，那是对的另一件事）
  const card = registry['#candidate-list'].children.find((c) => !hasExilusTag(c));
  const newName = candName(card);
  check('满槽时备选区仍有未装备的卡', Boolean(newName));
  if (card) {
    // dragover 必须 preventDefault（允许放置），否则浏览器会显示禁止符号
    // ⚠ 必须先 dragstart 再 dragover（真实浏览器就是这个顺序），否则没有拖拽载荷
    card.fire('dragstart');
    let prevented = false;
    const ev = { preventDefault() { prevented = true; }, dataTransfer: { dropEffect: '' } };
    for (const h of grid()[0]._listeners['dragover'] ?? []) h(ev);
    check('满槽时 dragover 允许放置（不再显示禁止符号）', prevented === true);
    grid()[0].fire('drop');
    const after = slotNames();
    check('满槽拖入 = 互换：新卡占目标槽', after[0] === newName);
    check('满槽拖入 = 互换：被替换的那张回到备选区', candNameList().includes(before[0]));
    check('互换不影响其它槽', ['1', '2', '3', '4', '5', '6', '7'].every((i) => after[+i] === before[+i]));
  }
}

// ── 6. 槽位之间拖到已占用槽 = 互换，两张都不丢（D-115）──
{
  recoverFullSlots();
  const before = slotNames().slice();
  grid()[0].fire('dragstart');
  grid()[2].fire('drop');
  const after = slotNames();
  check('拖到已占用的槽位会互换', after[2] === before[0] && after[0] === before[2]);
  check('目标槽原有 Mod 没有被顶掉', after.includes(before[2]));
  check('互换只动两个槽', ['1', '3', '4', '5', '6', '7'].every((i) => after[+i] === before[+i]));
}

// ── 7. 拖回备选区 = 卸下（D-040 不变：落在整块列表上）──
{
  grid()[0].fire('dragstart');
  registry['#candidate-list'].fire('drop');
  check('拖回备选区后槽位变空', slotTexts()[0].includes('空'));
}

// ── 7b. 拖到备选区的**某张卡**上 = 与该卡互换（D-115，不是卸下）──
{
  recoverFullSlots();
  const before = slotNames().slice();
  // 目标必须是**普通 Mod**（功能 Mod 不能进普通槽，不是互换对象）
  const target = registry['#candidate-list'].children.find((c) => !hasExilusTag(c));
  const targetName = candName(target);
  check('备选区有可互换的目标卡', Boolean(targetName));
  if (target) {
    grid()[3].fire('dragstart');
    target.fire('drop');
    const after = slotNames();
    check('槽位 Mod 拖到备选卡 = 互换：目标卡进源槽', after[3] === targetName);
    check('互换：槽里那张回到备选区', candNameList().includes(before[3]));
    check('互换：其它槽不动', ['0', '1', '2', '4', '5', '6', '7'].every((i) => after[+i] === before[+i]));
  }
}

// ── 7c. 目标卡不接受时（功能 Mod 拖到普通卡上）仍走「拖回备选区 = 卸下」──
{
  const exSlot = () => registry['#side-slots'].children[0];
  /** 备选区里第一张功能类卡（按卡片上的「功能」标签认，不靠名字） */
  const hush = registry['#candidate-list'].children.find(hasExilusTag);
  check('备选区能找到功能类 Mod', Boolean(hush));
  // 类型不符：功能 Mod（在劣化槽里）拖到**普通**备选卡上 → 卡片不接受，冒泡到列表 → 卸下
  if (hush) {
    hush.fire('dragstart');
    exSlot().fire('drop');
    check('功能 Mod 装进劣化槽', exSlot().textContent.includes(candName(hush)));
    const plain = registry['#candidate-list'].children.find((c) => !hasExilusTag(c));
    exSlot().fire('dragstart');
    // 卡片不接受 → 不吞 drop → 冒泡到 #candidate-list，由列表处理成"拖回备选区 = 卸下"
    registry['#candidate-list'].fire('drop');
    check('类型不符的目标卡不接受，按拖回备选区卸下', exSlot().textContent.includes('拖入功能 Mod'));
  }
  // 类型不符：普通槽 Mod 拖到**功能**备选卡上 → 同样卸下
  const plainCard = registry['#candidate-list'].children.find((c) => !hasExilusTag(c));
  if (plainCard) {
    plainCard.fire('dragstart');
    grid()[0].fire('drop');
    const exTarget = registry['#candidate-list'].children.find(hasExilusTag);
    const exTargetName = candName(exTarget);
    grid()[0].fire('dragstart');
    let swallowed = false;
    for (const h of exTarget._listeners.dragover ?? []) h({ preventDefault() { swallowed = true; }, dataTransfer: {} });
    check('功能卡不接受普通槽 Mod（不显示可放置）', swallowed === false);
    registry['#candidate-list'].fire('drop');
    check('普通槽 Mod 拖到功能卡上也按卸下处理', slotTexts()[0].includes('空'));
  }
}

// ── 7d. 劣化槽换卡 / 赋能换卡 = 互换，旧卡不再被静默顶掉（D-115）──
{
  const exSlot = () => registry['#side-slots'].children[0];
  const exCards = () => registry['#candidate-list'].children.filter(hasExilusTag);
  check('备选区有至少两张功能类 Mod', exCards().length >= 2);
  const first = exCards()[0];
  const firstName = candName(first);
  first.fire('dragstart');
  exSlot().fire('drop');
  check('第一张功能 Mod 进劣化槽', exSlot().textContent.includes(firstName));
  const second = exCards().find((c) => candName(c) !== firstName);
  const secondName = candName(second);
  second.fire('dragstart');
  exSlot().fire('drop');
  check('劣化槽换成第二张', exSlot().textContent.includes(secondName));
  check('原劣化槽那张回到备选区（不再静默顶掉）', candNameList().includes(firstName));

  // 赋能
  const arcSlot = () => registry['#arcane-slots'].children[0];
  const arcList = () => registry['#arcane-list'].children;
  check('赋能列表有至少两张', arcList().length >= 2);
  const a1 = arcList()[0];
  const a1Name = candName(a1);
  a1.fire('dragstart');
  arcSlot().fire('drop');
  check('第一个赋能进槽', arcSlot().textContent.includes(a1Name));
  const a2 = arcList()[0];
  const a2Name = candName(a2);
  a2.fire('dragstart');
  arcSlot().fire('drop');
  check('赋能槽换成第二个', arcSlot().textContent.includes(a2Name));
  check('原赋能回到列表（不再静默顶掉）', arcList().map(candName).includes(a1Name));
  // 拖回整块赋能列表 = 卸下
  arcSlot().fire('dragstart');
  registry['#arcane-list'].fire('drop');
  check('拖回赋能列表 = 卸下', arcSlot().textContent.includes('拖入赋能'));
}


// ── 8. 劣化槽限制 ──
{
  const hush = findCard('消音器') ?? findCard('弹匣增幅') ?? findCard('稳定');
  check('能找到一张功能 Mod', Boolean(hush));
  if (hush) {
    hush.fire('dragstart');
    grid()[1].fire('drop');
    check('功能 Mod 被普通槽拒绝', !slotTexts()[1].includes(hush.textContent.slice(0, 4)));
    hush.fire('dragstart');
    registry['#side-slots'].children[0].fire('drop');
    check('功能 Mod 可进劣化槽', !registry['#side-slots'].children[0].textContent.includes('拖入功能 Mod'));
  }
}

// ── 9. 赋能拖拽（D-028-3）──
{
  const arcaneSlots = registry['#arcane-slots'].children;
  check('存在赋能槽', arcaneSlots.length === 1);
  check('赋能槽初始为空', arcaneSlots[0].textContent.includes('拖入赋能'));
  const hush = findCard('消音器') ?? findCard('稳定');
  if (hush) {
    hush.fire('dragstart');
    arcaneSlots[0].fire('drop');
    check('Mod 不能被拖进赋能槽', arcaneSlots[0].textContent.includes('拖入赋能'));
  }
  check('赋能槽存在且不崩', arcaneSlots[0].children.length > 0);
}

// ── 10. 筛选按钮组（D-035：按钮 + 高亮，单选语义）──
{
  const group = registry['#candidate-filter'];
  check('筛选用按钮组', group.children.length === 10);
  const values = group.children.map((b) => b.textContent);
  check('筛选含 全部/伤害/多重/暴击/元素/物理/射速/触发/劣化/其他',
    ['全部', '伤害', '多重', '暴击', '元素', '物理', '射速', '触发', '劣化', '其他'].every((v) => values.includes(v)));
  check('当前筛选项高亮', group.children.some((b) => (b.className || '').includes('active')));

  const total = registry['#candidate-list'].children.length;
  const critBtn = group.children.find((b) => b.textContent === '暴击');
  critBtn.fire('click');
  const critCount = registry['#candidate-list'].children.length;
  check('筛选「暴击」后数量减少且非零', critCount > 0 && critCount < total);
  const activeNow = registry['#candidate-filter'].children.filter((b) => (b.className || '').includes('active'));
  check('只有一项高亮（单选）', activeNow.length === 1 && activeNow[0].textContent === '暴击');

  registry['#candidate-filter'].children.find((b) => b.textContent === '全部').fire('click');
  check('切回全部恢复', registry['#candidate-list'].children.length === total);
}

// ── 10b. 「触发」应包含带触发词条的元素卡（D-035 bug 修复）──
{
  const group = registry['#candidate-filter'];
  group.children.find((b) => b.textContent === '触发').fire('click');
  const shown = registry['#candidate-list'].children.map((c) => c.textContent);
  check('触发筛选有结果', shown.length > 0);
  check('触发筛选里包含带触发词条的元素卡',
    shown.some((t) => /火焰|冰冻|电击|毒素|毒气|磁力|辐射|病毒|腐蚀|爆炸/.test(t)));
  group.children.find((b) => b.textContent === '全部').fire('click');
}

// ── 11. 搜索框 ──
{
  const search = registry['#candidate-search'];
  const total = registry['#candidate-list'].children.length;
  search.value = '膛线';
  search.fire('input');
  check('搜索「膛线」能筛出结果', registry['#candidate-list'].children.some((c) => c.textContent.includes('膛线')));
  search.value = '';
  search.fire('input');
  check('清空搜索恢复', registry['#candidate-list'].children.length === total);
}

// ── 12. 武器专属 Mod 过滤（D-029）──
{
  const all = registry['#candidate-list'].children.map((c) => c.textContent);
  check('不出现武器专属卡', !all.some((t) => t.includes('专属')));
}

// ── 13. 爆头开关影响 Mod 增幅（D-027）──
{
  const read = () => registry['#candidate-list'].children.map((c) => c.textContent).join('|');
  registry['#headshot-toggle'].checked = false;
  registry['#headshot-toggle'].fire('change');
  const off = read();
  registry['#headshot-toggle'].checked = true;
  registry['#headshot-toggle'].fire('change');
  const on = read();
  check('开/关爆头会改变备选增幅', off !== on);
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

// ── 16. 口径单选框移到 Mod 槽位上方 ──
{
  const picker = registry['#metric-options'];
  check('增幅基准单选框存在', picker.children.length === 6);
  const opts = picker.children.map((l) => l.textContent);
  check('单选框使用新名称', opts.some((t) => t.includes('爆发伤害')) && opts.some((t) => t.includes('单弹头')));
}

// ── 17. 暴击分档常驻显示在伤害分布下 ──
{
  const box = registry['#crit-tiers'];
  check('暴击分档已渲染', box.children.length > 1);
  check('暴击分档含等级与平均倍率', box.textContent.includes('等级') && box.textContent.includes('平均'));
}

// ── 18. 赋能列表（D-032）──
{
  const list = registry['#arcane-list'];
  check('赋能列表已渲染', list.children.length > 0);
  check('赋能数量与列表一致', registry['#arcane-count'].textContent.includes(String(list.children.length)));
}

// ── 19. 拆解不含元素合成过程（D-033）──
{
  const card = registry['#candidate-list'].children[0];
  if (card) card.fire('click');
  const detail = registry['#detail'].textContent;
  check('拆解不再显示「元素合成」', !detail.includes('元素合成'));
  check('拆解仍显示输出口径对比', detail.includes('装备后') || detail.includes('当前'));
}

// ── 20. DoT 单位含 /层（D-033 补）──
check('DoT 每层秒伤单位含 /层', registry['#output-list'].textContent.includes('/层/秒'));

// ── 21. 范围伤害仅在含爆炸时显示（D-031 修订）──
{
  // 先清空（D-115 之后满槽也能拖入，所以必须显式清，否则前置状态不确定）
  for (let i = 0; i < grid().length; i++) dragOutSlot(i);
  check('无爆炸时范围伤害不显示', registry['#splash-damage'].children.length === 0);
  const cryo = registry['#candidate-list'].children.find((c) => c.textContent.includes('低温弹头'));
  const hell = registry['#candidate-list'].children.find((c) => c.textContent.includes('地狱火'));
  if (cryo) { cryo.fire('dragstart'); grid()[0].fire('drop'); }
  if (hell) { hell.fire('dragstart'); grid()[1].fire('drop'); }
  const after = registry['#splash-damage'];
  // 判定「真有爆炸」看渲染出来的面板有没有内容，而不是看伤害表文本——
  // 巴什穆自带电击，火+冰会先和电合成辐射，最后并没有爆炸。
  if (after.children.length > 0) {
    check('含爆炸时显示范围伤害面板', true);
    // 需求方 2026-11-12：「这里的六秒合计没删啊」——范围伤害只留每秒（数值 + 「/秒」），
    // 不再有「六秒合计」那一行。
    check('范围伤害只显示每秒，不再显示六秒合计',
      after.textContent.includes('/秒') && !after.textContent.includes('六秒'),
      after.textContent.slice(0, 120));
  } else {
    check('含爆炸时显示范围伤害面板（跳过：这把武器配不出爆炸）', true);
  }
}

// ── 22. 玄骸默认 60%（D-034）──
check('玄骸滑条默认 60', String(registry['#kuva-ratio'].value) === '60');
check('玄骸显示 60%', registry['#kuva-ratio-val'].textContent === '60%');

// ── 23. 爆头倍率用下拉框，只给 1/2/3，且在勾选框之后（D-034）──
{
  const sel = registry['#headshot-mult'];
  check('爆头倍率是 select', sel.tagName === 'SELECT');
  const vals = sel.children.map((o) => o.value).sort();
  check('爆头倍率只有 1/2/3 三档', vals.length === 3 && vals.join(',') === '1,2,3');
  const cbPos = html.indexOf('id="headshot-toggle"');
  const selPos = html.indexOf('id="headshot-mult"');
  check('爆头勾选框在倍率下拉之前', cbPos > 0 && cbPos < selPos);
}

// ── 24. 异常状态单位用 /秒 而不是「每秒」（D-034）──
{
  const text = registry['#dot-detail'].textContent;
  check('异常状态单位含 /秒', text.includes('/秒'));
  check('异常状态不再用「每秒」二字', !/[^/]每秒/.test(text.replace(/层\/秒/g, '')));
}

// ── 25. 版面结构（D-034）──
{
  const kuvaPos = html.indexOf('id="kuva-element"');
  const panelPos = html.indexOf('id="panel-table"');
  check('玄骸加成位于武器面板之上', kuvaPos > 0 && kuvaPos < panelPos);
  const dmgPos = html.indexOf('id="damage-table"');
  const outPos = html.indexOf('id="output-list"');
  check('伤害数值紧跟伤害分布之后', outPos > dmgPos && outPos - dmgPos < 400);
  const arcanePos = html.indexOf('id="arcane-list"');
  const detailPos = html.indexOf('id="detail"');
  // D-127：赋能待选区回到右栏、拆解**上方**（D-124 曾挪到中栏，拖到左边槽位太远）
  check('赋能列表在拆解之上（右栏）', arcanePos > 0 && arcanePos < detailPos);
  const candPos = html.indexOf('id="candidate-list"');
  check('备选 Mod 在中栏（在赋能之前）', candPos < arcanePos);
  const mainEnd = html.indexOf('</section>', candPos);
  check('赋能列表不再放在中栏', !(arcanePos > candPos && arcanePos < mainEnd));
  check('左栏标题改为「配置」', html.includes('>配置<'));
}

// ── 26. 已装备 Mod 不在备选区重复显示 ──
{
  recoverFullSlots();
  const installed = new Set(slotNames().filter(Boolean));
  check('8 槽已满', slotNames().filter(Boolean).length === 8);
  const candNames = candNameList();
  check('已装备 Mod 不在备选区显示', !candNames.some((n) => installed.has(n)));
  check('满槽时备选区仍列出未装备的卡', candNames.length > 0);
}

// ── 27. 不自动紧凑：放哪就是哪（D-035）──
{
  recoverFullSlots();
  dragOutSlot(2);
  check('卸下后槽位 3 为空', slotNames()[2] === null);

  const before = slotNames().slice();
  const installed = new Set(before.filter(Boolean));
  // 要测"放哪就是哪"，卡必须是**普通 Mod**（功能 Mod 只能进劣化槽）
  const freeCard = registry['#candidate-list'].children.find((c) => !hasExilusTag(c) && !installed.has(candName(c)));
  check('有空位时备选区有可选卡', Boolean(freeCard));
  if (freeCard) {
    const newName = candName(freeCard);
    freeCard.fire('dragstart');
    grid()[2].fire('drop');
    const after2 = slotNames();
    check('拖到空槽位（3）成功', after2[2] === newName);
    check('其它槽位一律不动（不自动前移填洞）',
      ['0', '1', '3', '4', '5', '6', '7'].every((i) => after2[+i] === before[+i]));
    check('前面的空位没有被后面的 Mod 前移填上', after2[1] === before[1]);
  }
}

// ── 27b. 有空槽时拖到**已占用**槽也是互换（D-115）──
{
  recoverFullSlots();
  const before = slotNames().slice();
  dragOutSlot(2);
  check('留一个空槽', slotNames()[2] === null);
  const freeCard = registry['#candidate-list'].children.find((c) => !hasExilusTag(c));
  const newName = candName(freeCard);
  freeCard.fire('dragstart');
  grid()[5].fire('drop');
  const after = slotNames();
  check('拖到已占用槽位（6）= 互换：新卡占槽 6', after[5] === newName);
  check('互换：槽 6 原来那张回到备选区', candNameList().includes(before[5]));
  check('互换：空槽仍然是空的（不自动紧凑）', after[2] === null);
  check('互换：其它槽不动', ['0', '1', '3', '4', '7'].every((i) => after[+i] === before[+i]));
}

// ── 28. 满槽时每一张拖到任意槽都能互换，不会丢卡（D-115）──
{
  recoverFullSlots();
  const before = slotNames().slice();
  const card = registry['#candidate-list'].children.find((c) => !hasExilusTag(c));
  for (let i = 0; i < 8; i++) grid()[i].fire('drop');
  check('同一张卡依次拖到 8 个槽都只互换', slotNames().filter(Boolean).length === 8);
  check('互换后没有 Mod 丢失', slotNames().filter(Boolean).length === before.filter(Boolean).length);
}

// ── 29. 备选区增幅不应出现负数（D-037）──
{
  recoverFullSlots();
  const btn = findDeep(grid()[7], 'button');
  if (btn) btn.fire('click');
  const gains = registry['#candidate-list'].children
    .map((c) => {
      const g = c.children.find((x) => (x.className || '').indexOf('cand-gain') >= 0);
      return g ? g.textContent : '';
    })
    .filter((t) => t);
  check('备选区有增幅显示', gains.length > 0);
  const negCount = gains.filter((t) => /-[\d.]+%/.test(t)).length;
  check('负数增幅不是大面积出现（<10%）', negCount < gains.length * 0.1);
}

rec.finish();
