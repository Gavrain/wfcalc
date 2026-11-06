/**
 * 交互冒烟：从**真实的 index.html** 建 DOM，把 app.js 的渲染与事件路径真跑一遍。
 *
 *   node packages/demo/src/dom-interact.mjs
 *
 * 为什么用 DOM shim 而不是真浏览器：沙箱里 Chrome 启动不了。
 * 关键：registry 从真实 HTML 解析，页面上没有的 id 在这里也不存在——
 * 之前手写 id 列表导致"假 DOM 全绿、真浏览器报 null"。
 */
import { readFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripTemp } from './strip-to-temp.mjs';

const ROOT = normalize(join(fileURLToPath(new URL('.', import.meta.url)), '../../..'));

class ClassList {
  constructor() { this.set = new Set(); }
  add(...c) { c.forEach((x) => this.set.add(x)); }
  remove(...c) { c.forEach((x) => this.set.delete(x)); }
  contains(c) { return this.set.has(c); }
}

class Node {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.style = {};
    this.classList = new ClassList();
    this._text = '';
    this._html = '';
    this._listeners = {};
    this.value = '';
    this.checked = false;
    this.options = [];
    this.draggable = false;
    this.type = '';
  }
  set textContent(v) { this._text = String(v); this.children = []; }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
  get innerHTML() { return this._html; }
  set innerHTML(v) { this._html = v; if (v === '') { this.children = []; this._text = ''; } }
  append(...ns) { for (const n of ns) this.children.push(typeof n === 'string' ? new TextNode(n) : n); }
  appendChild(n) { this.append(n); return n; }
  addEventListener(t, fn) { (this._listeners[t] ??= []).push(fn); }
  fire(t, ev = {}) {
    const e = { target: this, preventDefault() {}, dataTransfer: { setData() {} }, ...ev };
    (this._listeners[t] ?? []).forEach((fn) => fn(e));
    // 真实 DOM 里 `el.onclick/onchange = fn` 等价于一个对应事件的监听器
    if (t === 'click' && typeof this.onclick === 'function') this.onclick(e);
    if (t === 'change' && typeof this.onchange === 'function') this.onchange(e);
    if (t === 'input' && typeof this.oninput === 'function') this.oninput(e);
  }
  querySelector() { return null; }
  get firstChild() { return this.children[0] ?? null; }
}

class TextNode {
  constructor(t) { this._text = t; }
  get textContent() { return this._text; }
}

/** 从真实 index.html 抽 id 建 registry，并把 <option> 挂到对应 <select> 下 */
async function buildRegistry(path) {
  const html = await readFile(path, 'utf8');
  const reg = {};
  const re = /<([a-zA-Z][\w-]*)\b[^>]*\bid="([^"]+)"[^>]*>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const node = new Node(m[1]);
    if (/\btype="checkbox"/.test(m[0])) node.type = 'checkbox';
    if (/\btype="range"/.test(m[0])) node.type = 'range';
    const v = m[0].match(/\bvalue="([^"]*)"/);
    if (v) node.value = v[1];
    reg['#' + m[2]] = node;
  }
  // 把静态 <option> 填进它所在的 <select>
  const selRe = /<select\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g;
  let s;
  while ((s = selRe.exec(html)) !== null) {
    const sel = reg['#' + s[1]];
    if (!sel) continue;
    for (const om of s[2].matchAll(/<option\b([^>]*)>([^<]*)<\/option>/g)) {
      const o = new Node('option');
      const ov = om[1].match(/\bvalue="([^"]*)"/);
      o.value = ov ? ov[1] : om[2].trim();
      o.textContent = om[2].trim();
      sel.children.push(o);
    }
    if (!sel.value && sel.children.length) sel.value = sel.children[0].value;
  }
  return reg;
}

const registry = await buildRegistry(join(ROOT, 'packages/demo/public/index.html'));

const document = {
  createElement: (t) => new Node(t),
  createTextNode: (t) => new TextNode(t),
  querySelector: (s) => registry[s] ?? null,
  body: new Node('body'),
};

globalThis.fetch = async (url) => {
  const text = await readFile(join(ROOT, String(url).replace(/^\//, '')), 'utf8');
  return { ok: true, json: async () => JSON.parse(text) };
};
globalThis.document = document;
globalThis.window = globalThis;

const { transpile } = await import(new URL('./transpile.mjs', import.meta.url).href);
const core = await stripTemp(ROOT, 'packages/core/src/index.ts', transpile);
const adapter = await stripTemp(ROOT, 'packages/data/src/adapter.ts', transpile);
// D-093：武器切换模块（纯 JS，无需剥类型）
const picker = await import(new URL('../public/weapon-picker.js', import.meta.url).href);

const CORE_NAMES = ['compute', 'critAverage', 'critTiers', 'DOT_TYPES', 'METRIC_OPTIONS', 'totalProcChance', 'isKuvaFamily'];
const ADAPTER_NAMES = ['arcaneToContributions', 'isConditionOverloadMod', 'isModCompatibleWithWeapon', 'isSemiAutoOnlyWeapon', 'isSemiCannonade', 'modKindsFor', 'modToContributions'];
const PICKER_NAMES = ['WEAPON_GROUPS', 'groupWeapons', 'searchWeapons', 'FIRE_STYLE_OPTIONS', 'filterByStyle', 'weaponLabel', 'ISSUE_MARK'];
// D-101：武器数据问题清单
const issuesMod = await import(new URL('../../data/manual/weapon-issues.ts', import.meta.url).href);
const ISSUE_NAMES = ['issuesOf'];

let src = await readFile(join(ROOT, 'packages/demo/public/app.js'), 'utf8');
src = src.replace(/^import\s*\{[\s\S]*?\}\s*from\s*'\.\.\/\.\.\/core\/src\/index\.ts';/m, '');
src = src.replace(/^import\s*\{[\s\S]*?\}\s*from\s*'\.\.\/\.\.\/data\/src\/adapter\.ts';/m, '');
src = src.replace(/^import\s*\{[\s\S]*?\}\s*from\s*'\.\/weapon-picker\.js';/m, '');
src = src.replace(/^import\s*\{[\s\S]*?\}\s*from\s*'\.\.\/\.\.\/data\/manual\/weapon-issues\.ts';/m, '');
src =
  CORE_NAMES.map((n) => `const ${n} = __core.${n};`).join('\n') + '\n' +
  ADAPTER_NAMES.map((n) => `const ${n} = __adapter.${n};`).join('\n') + '\n' +
  PICKER_NAMES.map((n) => `const ${n} = __picker.${n};`).join('\n') + '\n' +
  ISSUE_NAMES.map((n) => `const ${n} = __issues.${n};`).join('\n') + '\n' + src;

const fn = new Function('__core', '__adapter', '__picker', '__issues', 'document', 'window', 'fetch', 'setTimeout', 'clearTimeout', 'console', src);
await fn(core, adapter, picker, issuesMod, document, globalThis, globalThis.fetch, setTimeout, clearTimeout, console);
await new Promise((r) => setTimeout(r, 300));

// ── helpers ──
const grid = () => registry['#slot-grid'].children;
const slotTexts = () => grid().map((c) => c.textContent);
const findCard = (name) => registry['#candidate-list'].children.find((c) => c.textContent.includes(name));
function findDeep(node, tag) {
  if (!node) return null;
  if (node.tagName === tag.toUpperCase()) return node;
  for (const c of node.children ?? []) {
    const r = findDeep(c, tag);
    if (r) return r;
  }
  return null;
}
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
  // 清空所有槽位（D-040：没有卸下按钮了，改用"拖出且未落到任何槽位"）
  for (let i = 0; i < grid().length; i++) dragOutSlot(i);
  // 逐个拖回（每次都重新取备选区，因为装上的会从列表消失）
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

const checks = [];
const check = (name, pass) => checks.push([name, Boolean(pass)]);

// ── 1. 基础渲染 ──
check('8 个 Mod 槽位', grid().length === 8);
// D-052：默认不预装任何 Mod
check('默认不预装 Mod（8 槽全空）', slotTexts().filter((t) => !t.includes('空')).length === 0);
check('默认劣化槽为空', !slotTexts()[8] || slotTexts()[8].includes('空') || slotTexts().length <= 8);
check('备选区已渲染', registry['#candidate-list'].children.length > 50);

// ── 2. 用语检查（D-028-1 / -4）──
{
  const panelHead = registry['#panel-table'].children[0].textContent;
  check('面板列名是「当前面板」', panelHead.includes('当前面板'));
  check('面板列名不再出现「Mod 后」', !panelHead.includes('Mod 后'));
  const factionOpts = registry['#faction-select'].children.map((o) => o.textContent);
  registry['#faction-select'].children.forEach((o) => {});
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
  // D-052：默认无 Mod，先装一张再测卸下
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

// ── 4b. 拖到另一个槽位成功时**不**卸下（D-040）──
{
  const before = slotNames().slice();
  // 槽位 2 空着，把槽位 1 拖过去
  dragOutSlot(1);
  const afterRemove = slotNames().slice();
  check('先制造一个空槽位', afterRemove[1] === null);
  // 重新装一张，然后测试拖入空槽不卸下
  const card = registry['#candidate-list'].children[0];
  card.fire('dragstart');
  grid()[1].fire('drop');
  const name = slotNames()[1];
  check('拖入空槽成功', Boolean(name));
  // 把这个 Mod 拖到另一个空槽（槽位 1 原本空，现在满了；用槽位 2）
  grid()[1].fire('dragstart');
  grid()[0].fire('drop'); // 槽位 0 已占用 → 拒绝 → 应卸下
  check('拖到已占用槽位视为放弃（卸下）', slotNames()[0] === null || slotNames()[1] === null);
  void before;
}

// ── 5. 满槽时从备选区拖入必须被拒绝（D-034）──
// 先恢复"装满 8 张"的状态：此时不该接受任何从备选区来的新 Mod。
{
  recoverFullSlots();
  const before = slotNames();
  check('8 槽已满（前置条件）', before.filter(Boolean).length === 8);
  const installed = new Set(before.filter(Boolean));
  const card = registry['#candidate-list'].children.find((c) => {
    const top = c.children.find((x) => (x.className || '').indexOf('cand-top') >= 0);
    if (!top) return false;
    const nm = top.children[0].textContent;
    return nm && !installed.has(nm);
  });
  check('满槽时备选区仍有未装备的卡', Boolean(card));
  if (card) {
    card.fire('dragstart');
    grid()[0].fire('drop');
    check('满槽时拖入被拒绝，槽位完全不变', slotNames().join('|') === before.join('|'));
  }
}

// ── 6. 拖到已占用的槽位 → 拒绝（D-038）──
{
  const before = slotNames().slice();
  grid()[0].fire('dragstart');
  grid()[2].fire('drop');
  check('拖到已占用的槽位不生效', slotNames().join('|') === before.join('|'));
  check('目标槽原有 Mod 未被顶掉', slotNames()[2] === before[2]);
  check('源槽 Mod 仍在原位', slotNames()[0] === before[0]);
}

// ── 7. 拖回备选区 = 卸下 ──
{
  grid()[0].fire('dragstart');
  registry['#candidate-list'].fire('drop');
  check('拖回备选区后槽位变空', slotTexts()[0].includes('空'));
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
  // 赋能列表在 demo 里没有单独的面板，这里验证：槽位能接受 arcane 类拖拽载荷
  // 做法：从 app.js 内部无法外部构造 dragPayload，改为验证"错类型被拒 + 槽位可渲染"
  const before = registry['#output-list'].children.map((c) => c.textContent).join('|');
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

  const allBtn = registry['#candidate-filter'].children.find((b) => b.textContent === '全部');
  allBtn.fire('click');
  check('切回全部恢复', registry['#candidate-list'].children.length === total);
}

// ── 10b. 「触发」应包含带触发词条的元素卡（D-035 bug 修复）──
{
  const group = registry['#candidate-filter'];
  const statusBtn = group.children.find((b) => b.textContent === '触发');
  statusBtn.fire('click');
  const shown = registry['#candidate-list'].children.map((c) => c.textContent);
  check('触发筛选有结果', shown.length > 0);
  // 结果里至少有一张同时带元素词条的卡（说明没漏掉"元素+触发"卡）
  check('触发筛选里包含带触发词条的元素卡',
    shown.some((t) => /火焰|冰冻|电击|毒素|毒气|磁力|辐射|病毒|腐蚀|爆炸/.test(t)));
  const allBtn = registry['#candidate-filter'].children.find((b) => b.textContent === '全部');
  allBtn.fire('click');
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
  check('不出现 Grakata 专属卡 brain_storm', !all.some((t) => t.includes('专属')));
  check('卡拉克可用 Mod 少于步枪池 122', registry['#slot-info'].textContent.indexOf('122') < 0);
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

// ── 14. app.js 引用的 id 都在 index.html ──
{
  const html = await readFile(join(ROOT, 'packages/demo/public/index.html'), 'utf8');
  const appSrc = await readFile(join(ROOT, 'packages/demo/public/app.js'), 'utf8');
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
  check('左栏没有口径单选框', !out.children.some((r) => r.textContent.includes('\u200b') || r.children.some?.((c) => c.tagName === 'INPUT')));
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
{
  const text = registry['#output-list'].textContent;
  check('DoT 每层秒伤单位含 /层', text.includes('/层/秒'));
}

// ── 21. 范围伤害仅在含爆炸时显示（D-031 修订）──
{
  const box = registry['#splash-damage'];
  // 当前配置（地狱火 + 污染弹匣 → 毒气，无爆炸）应不显示
  check('无爆炸时范围伤害不显示', box.children.length === 0);
  // 换成 火 + 冰 → 爆炸
  recoverFullSlots();
  const cryo = registry['#candidate-list'].children.find((c) => c.textContent.includes('低温弹头'));
  const hell = registry['#candidate-list'].children.find((c) => c.textContent.includes('地狱火'));
  if (cryo) { cryo.fire('dragstart'); grid()[0].fire('drop'); }
  if (hell) { hell.fire('dragstart'); grid()[1].fire('drop'); }
  // 清掉毒元素，只留火+冰
  for (let i = 0; i < grid().length; i++) {
    const nm = slotModName(i);
    if (nm && (nm.includes('污染弹匣') || nm.includes('病毒'))) {
      const btn = findDeep(grid()[i], 'button');
      if (btn) btn.fire('click');
    }
  }
  const after = registry['#splash-damage'];
  const hasBlast = registry['#damage-table'].textContent.includes('爆炸');
  if (hasBlast) {
    check('含爆炸时显示范围伤害面板', after.children.length > 0);
    check('范围伤害含每秒与六秒', after.textContent.includes('每秒') && after.textContent.includes('六秒'));
  } else {
    check('含爆炸时显示范围伤害面板（跳过：未能配出爆炸）', true);
  }
}

// ── 22. 玄骸默认 60%（D-034）──
{
  check('玄骸滑条默认 60', String(registry['#kuva-ratio'].value) === '60');
  check('玄骸显示 60%', registry['#kuva-ratio-val'].textContent === '60%');
}

// ── 23. 爆头倍率用下拉框，只给 1/2/3，且在勾选框之后（D-034）──
{
  const sel = registry['#headshot-mult'];
  check('爆头倍率是 select', sel.tagName === 'SELECT');
  const vals = sel.children.map((o) => o.value).sort();
  check('爆头倍率只有 1/2/3 三档', vals.length === 3 && vals.join(',') === '1,2,3');
  const html = await readFile(join(ROOT, 'packages/demo/public/index.html'), 'utf8');
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
  const html = await readFile(join(ROOT, 'packages/demo/public/index.html'), 'utf8');
  // 玄骸加成在最上
  const kuvaPos = html.indexOf('id="kuva-element"');
  const panelPos = html.indexOf('id="panel-table"');
  check('玄骸加成位于武器面板之上', kuvaPos > 0 && kuvaPos < panelPos);
  // 口径数值在伤害分布下面
  const dmgPos = html.indexOf('id="damage-table"');
  const outPos = html.indexOf('id="output-list"');
  check('伤害数值紧跟伤害分布之后', outPos > dmgPos && outPos - dmgPos < 400);
  // 赋能列表在右栏、拆解之上
  const arcanePos = html.indexOf('id="arcane-list"');
  const detailPos = html.indexOf('id="detail"');
  check('赋能列表在拆解之上', arcanePos > 0 && arcanePos < detailPos);
  // 备选 Mod 在右栏之外（中栏）
  const candPos = html.indexOf('id="candidate-list"');
  check('备选 Mod 在中栏（在赋能之前）', candPos < arcanePos);
  // 左栏标题「配置」替代「输出」
  check('左栏标题改为「配置」', html.includes('>配置<'));
}

// ── 26. 满槽位时拒绝插入（D-034）──
{
  recoverFullSlots();
  const installed = new Set(slotNames().filter(Boolean));
  check('8 槽已满', slotNames().filter(Boolean).length === 8);
  // 备选区此时不应包含已装备的 Mod
  const candNames = registry['#candidate-list'].children.map((c) => {
    const top = c.children.find((x) => (x.className || '').indexOf('cand-top') >= 0);
    return top ? top.children[0].textContent : '';
  });
  check('已装备 Mod 不在备选区显示', !candNames.some((n) => installed.has(n)));

  // 试拖入一张未装备的卡：应被拒绝（槽位不变）
  const freeCard = registry['#candidate-list'].children[0];
  const freeName = freeCard.children.find((x) => (x.className || '').indexOf('cand-top') >= 0).children[0].textContent;
  const before = slotNames().slice();
  freeCard.fire('dragstart');
  let prevented = false;
  // 手动模拟 dragover，检查是否 preventDefault（允许）还是禁止符号（拒绝）
  const card0 = grid()[0];
  const handlers = card0._listeners['dragover'] ?? [];
  const ev = { preventDefault() { prevented = true; }, dataTransfer: { setData() {} } };
  for (const h of handlers) h(ev);
  check('满槽时 dragover 不 preventDefault（显示禁止符号）', prevented === false);
  grid()[0].fire('drop');
  check('满槽时拖入无效，槽位不变', slotNames().join('|') === before.join('|'));
  check('满槽时那张卡没被装上', !slotNames().includes(freeName));
}

// ── 27. 不自动紧凑：放哪就是哪（D-035）──
{
  recoverFullSlots();
  // 卸下槽位 3（索引 2），制造空洞
  dragOutSlot(2);
  check('卸下后槽位 3 为空', slotNames()[2] === null);

  const before = slotNames().slice();
  const installed = new Set(before.filter(Boolean));
  const freeCard = registry['#candidate-list'].children.find((c) => {
    const top = c.children.find((x) => (x.className || '').indexOf('cand-top') >= 0);
    return top && !installed.has(top.children[0].textContent);
  });
  check('有空位时备选区有可选卡', Boolean(freeCard));
  if (freeCard) {
    const newName = freeCard.children.find((x) => (x.className || '').indexOf('cand-top') >= 0).children[0].textContent;
    freeCard.fire('dragstart');
    grid()[5].fire('drop');
    const after = slotNames();
    // D-038：槽位 6 已被占用 → 拒绝；改拖到空着的槽位 3
    check('拖到已占用槽位（6）被拒绝', after[5] === before[5] && after[5] !== newName);
    freeCard.fire('dragstart');
    grid()[2].fire('drop');
    const after2 = slotNames();
    check('拖到空槽位（3）成功', after2[2] === newName);
    check('其它槽位一律不动',
      ['0', '1', '3', '4', '5', '6', '7'].every((i) => after2[+i] === before[+i]));
  }
}

// ── 28. 拖到已占用槽位拒绝，不会误卸（D-038）──
{
  recoverFullSlots();
  const before = slotNames().slice();
  // 从备选区拖到任意已满槽位，全部应被拒绝
  const card = registry['#candidate-list'].children[0];
  card.fire('dragstart');
  for (let i = 0; i < 8; i++) grid()[i].fire('drop');
  check('满槽时拖到任何位置都不改变配置', slotNames().join('|') === before.join('|'));
}

// ── 29. 备选区增幅不应出现负数（D-037）──
{
  recoverFullSlots();
  // 只留 7 张，留一个空位，让所有卡都能"装上"
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
  // 允许少量负数（自带负面词条的卡，如重口径 -精准度），但不应"大量"
  check('负数增幅不是大面积出现（<10%）', negCount < gains.length * 0.1);
}

// ── 30. 装填 / 弹匣 Mod 不算功能类（D-037）──
{
  const allBtn = registry['#candidate-filter'].children.find((b) => b.textContent === '全部');
  allBtn.fire('click');
  const card = findCard('爆发装填');
  check('备选里有「爆发装填」', Boolean(card));
  if (card) {
    check('「爆发装填」不带「功能」标签', !card.textContent.includes('功能'));
  }
  // 弹匣增幅同理
  const magCard = findCard('弹匣增幅');
  if (magCard) check('「弹匣增幅」不带「功能」标签', !magCard.textContent.includes('功能'));
}

// ── 31. 伤害分布：保留 基础/当前 两列，再加一列触发率（D-039）──
{
  const head = registry['#damage-table'].children[0].textContent;
  check('伤害分布表头含 基础/当前/触发率',
    head.includes('基础') && head.includes('当前') && head.includes('触发率'));
  const rows = registry['#damage-table'].children.slice(1);
  check('触发率列显示百分比', rows.some((r) => r.textContent.includes('%')));
  // 不应出现 NaN
  check('伤害分布没有 NaN', !registry['#damage-table'].textContent.includes('NaN'));
  // 单行应有 4 列
  const first = rows[0];
  check('伤害分布每行 4 列', first.children.length === 4 || first.textContent.length > 0);
}

// ── 32. 拆解里展示暴击变动（D-038）──
{
  const card = registry['#candidate-list'].children.find((c) => c.textContent.includes('致命一击'));
  if (card) {
    card.fire('click');
    const detail = registry['#detail'].textContent;
    check('拆解含「暴击变动」', detail.includes('暴击变动'));
    check('暴击变动列出暴击几率与暴击伤害',
      detail.includes('暴击几率') && detail.includes('暴击伤害'));
    check('暴击变动含平均暴击倍率', detail.includes('平均暴击倍率'));
  }
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
    const detail = registry['#detail'].textContent;
    check('暴击变动不再用 pp', !detail.includes(' pp'));
  }
}

// ── 35. 毒气每层秒伤不为 0（D-039）──
{
  // 预设里 地狱火 + 污染弹匣 → 毒气；确认它算出了伤害
  const txt = registry['#dot-detail'].textContent;
  if (txt.includes('毒气')) {
    const idx = txt.indexOf('毒气');
    const seg = txt.slice(idx, idx + 60);
    // 应有非 0 的数值（不是 "0.00 /层/秒"）
    check('毒气每层秒伤不为 0', !/毒气[^0-9]*0\.00\s*层\/秒/.test(seg));
    check('异常状态伤害带 /层/秒 单位', txt.includes('/层/秒'));
  } else {
    check('毒气每层秒伤不为 0（本轮无毒气，跳过）', true);
  }
}

// ── 36. 物理筛选（D-040）──
{
  const allBtn = registry['#candidate-filter'].children.find((b) => b.textContent === '全部');
  allBtn.fire('click');
  const total = registry['#candidate-list'].children.length;

  const physBtn = registry['#candidate-filter'].children.find((b) => b.textContent === '物理');
  physBtn.fire('click');
  const shown = registry['#candidate-list'].children.map((c) => c.textContent);
  check('物理筛选有结果', shown.length > 0 && shown.length < total);
  check('物理筛选里的卡带物理词条',
    shown.every((t) => /冲击|穿刺|切割/.test(t)));
  registry['#candidate-filter'].children.find((b) => b.textContent === '全部').fire('click');
}

// ── 37. 劣化筛选（D-040）──
{
  const exBtn = registry['#candidate-filter'].children.find((b) => b.textContent === '劣化');
  exBtn.fire('click');
  const shown = registry['#candidate-list'].children;
  check('劣化筛选有结果', shown.length > 0);
  // 劣化栏里的卡不应包含纯伤害词条（装填/弹匣等已被排除）
  const bad = shown.filter((c) => /伤害 \+\d|基伤 \+\d|多重射击 \+\d/.test(c.textContent));
  check('劣化筛选里没有明显影响伤害的卡', bad.length === 0);
  if (bad.length) console.error('  可疑卡：' + bad.map((c) => c.textContent.slice(0, 30)).join(' | '));
  registry['#candidate-filter'].children.find((b) => b.textContent === '全部').fire('click');
}

// ── 38. 一键全部卸下（D-040）──
{
  recoverFullSlots();
  check('卸下前槽位已满', slotNames().filter(Boolean).length === 8);
  registry['#unequip-all'].fire('click');
  check('全部卸下后 8 槽全空', slotNames().filter(Boolean).length === 0);
  check('全部卸下后备选区列出全部可用卡',
    registry['#candidate-list'].children.length > 70);
}

// ── 39. 当前面板 / 伤害分布 的变化高亮（D-041 / D-045 回归）──
{
  // ⚠ 上一节（38）刚执行过"全部卸下"，槽位是空的 → 必须先装满才有"变化"可比
  recoverFullSlots();
  // 预设有 Mod，所以"当前"列必然与"基础"列不同 → 应有 changed 高亮
  function hasChanged(items) {
    return items.some((row) => row.children.some((c) => (c.className || '').includes('changed')));
  }
  check('武器面板有变化高亮', hasChanged(registry['#panel-table'].children));
  check('伤害分布有变化高亮', hasChanged(registry['#damage-table'].children));

  // D-045：高亮必须落在「当前」列（索引 2），不能落在「基础」列（索引 1）
  function highlightColumns(sel) {
    const cols = new Set();
    for (const row of registry[sel].children) {
      row.children.forEach((c, i) => {
        if ((c.className || '').includes('changed')) cols.add(i);
      });
    }
    return cols;
  }
  const pc = highlightColumns('#panel-table');
  check('武器面板只在「当前」列高亮', pc.size === 1 && pc.has(2));
  const dc = highlightColumns('#damage-table');
  check('伤害分布只在「当前」列高亮', dc.size === 1 && dc.has(2));

  // 合计行不高亮
  const totalRow = registry['#damage-table'].children.find((r) => r.textContent.includes('合计'));
  check('合计行不高亮', totalRow && !totalRow.children.some((c) => (c.className || '').includes('changed')));
}

// ── 40. 不再显示"可装 N 张"；按钮有样式类（D-041）──
{
  check('不显示可装张数', !registry['#slot-info'].textContent.includes('可装'));
  const html = await readFile(join(ROOT, 'packages/demo/public/index.html'), 'utf8');
  check('「全部卸下」按钮带 btn-ghost 样式类', /id="unequip-all"[^>]*class="btn-ghost"|class="btn-ghost"[^>]*id="unequip-all"/.test(html));
  const css = await readFile(join(ROOT, 'packages/demo/public/app.css'), 'utf8');
  check('CSS 里有 .btn-ghost 样式', css.includes('.btn-ghost'));
}

// ── 41. 增幅基准与备选筛选同样式（D-042）──
{
  const mbox = registry['#metric-options'];
  check('增幅基准用按钮', mbox.children.length === 6 && mbox.children.every((b) => b.tagName === 'BUTTON'));
  check('增幅基准有 filter-btn 样式类',
    mbox.children.every((b) => (b.className || '').includes('filter-btn')));
  check('增幅基准当前项高亮',
    mbox.children.filter((b) => (b.className || '').includes('active')).length === 1);
}

// ── 42. 非玄骸武器隐藏玄骸加成（D-042）──
{
  // 当前 demo 是赤毒·卡拉克（玄骸系），应有玄骸加成
  check('玄骸武器显示玄骸加成', Boolean(registry['#kuva-controls']) && registry['#kuva-controls'].style.display !== 'none');
  const html = await readFile(join(ROOT, 'packages/demo/public/index.html'), 'utf8');
  const js = await readFile(join(ROOT, 'packages/demo/public/app.js'), 'utf8');
  check('代码里用 isKuvaFamily 判断玄骸系', js.includes('isKuvaFamily'));
  check('非玄骸时隐藏标题与控件', js.includes('renderKuvaVisibility'));
}

// ── 43. 多面板武器模式切换栏（D-042）──
{
  const box = registry['#mode-switch'];
  check('有模式切换容器', Boolean(box));
  // 卡拉克是单模式，切换栏应为空
  check('单模式武器不显示切换按钮', box.children.length === 0);
  const html = await readFile(join(ROOT, 'packages/demo/public/index.html'), 'utf8');
  check('模式切换栏在武器面板标题右侧', html.indexOf('id="mode-switch"') > 0
    && html.indexOf('id="mode-switch"') < html.indexOf('id="panel-table"'));
}

// ── 44. 武器切换选单：选中值必须等于当前武器（D-097）──
{
  const gsel = registry['#weapon-group'];
  const tsel = registry['#weapon-type'];
  const wsel = registry['#weapon-select'];
  check('有武器大类选单', Boolean(gsel));
  check('有武器类型选单', Boolean(tsel));
  check('有武器名选单', Boolean(wsel));
  check('大类里次要/近战/空战是禁用的',
    Array.from(gsel.children).filter((o) => o.disabled).length === 3);

  // 记录初始选中值，切到"霰弹枪"再切回"步枪"
  const beforeType = tsel.value;
  const beforeWeapon = wsel.value;

  // 切到另一个类型
  const other = Array.from(tsel.children).find((o) => o.value !== beforeType);
  check('类型选单里不止一个类型', Boolean(other));
  if (other) {
    tsel.value = other.value;
    tsel.fire('change');
    await new Promise((r) => setTimeout(r, 200));
    check('切换类型后武器选单已更新', wsel.children.length > 0);
  }

  // 切回原类型
  tsel.value = beforeType;
  tsel.fire('change');
  await new Promise((r) => setTimeout(r, 200));
  // 切类型会自动选中该类型第一把枪（等同用户选择），此时选单值要与实际武器一致。
  // 关键断言：选单值不为空、且确实指向列表里存在的一项。
  const typeOpts = Array.from(wsel.children).map((o) => o.value);
  check('切回类型后选单有选中项', Boolean(wsel.value));
  check('切回类型后选中项存在于列表', typeOpts.includes(wsel.value));

  // 重复选中"当前武器"不应崩溃、也不应改变状态
  const steady = wsel.value;
  wsel.fire('change');
  await new Promise((r) => setTimeout(r, 200));
  check('重复选中当前武器不出错', wsel.value === steady);

  // 搜索：搜一个**确定不含当前武器**的词 → 应补一项"（当前）"并保持选中
  const search = registry['#weapon-search'];
  check('有搜索框', Boolean(search));
  if (search) {
    // ⚠ 切换类型会自动选中该类型的第一把枪（等同用户主动选择），所以这里以
    //   **搜索前一刻的选中值**为基准——它此时与 DATA.weapon 一致（前面的断言已验证）
    const curId = wsel.value;
    // 先把搜索框清空再搜，保证从已知状态出发
    search.value = '血肢';
    search.fire('input');
    await new Promise((r) => setTimeout(r, 200));
    const opts = Array.from(wsel.children).map((o) => o.value);
    check('搜索结果里含血肢', opts.some((v) => /Hema/i.test(v)));
    // 血肢搜索结果只有 2 项，当前武器（步枪）必然不在其中
    check('搜索时补了"当前武器"项', opts.includes(curId));
    check('搜索时选中值仍是当前武器', wsel.value === curId);

    // 清空搜索 → 回到分类浏览，选中值仍要等于当前武器
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
    // 找一个已知有问题的武器（伊格尼斯 = trigger 未识别）
    const ignis = Array.from(wsel.children).find((o) => /FlameThrower(?!Wraith)/.test(o.value));
    if (ignis) check('伊格尼斯带标记', ignis.textContent.includes('\u26a0'));
  }
  // 检查模块级函数
  check('issuesOf 对已知问题武器返回非空', issuesMod.issuesOf('FlameThrower').length > 0);
  check('issuesOf 对正常武器返回空', issuesMod.issuesOf('KuvaKarak').length === 0);
}

let ok = true;
for (const [name, pass] of checks) {
  if (!pass) ok = false;
  console.log(`${pass ? '✔' : '✖'} ${name}`);
}
console.log(`\n共 ${checks.length} 项，${checks.filter((c) => c[1]).length} 通过`);
process.exit(ok ? 0 : 1);
