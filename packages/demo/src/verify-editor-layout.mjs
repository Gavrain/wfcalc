/**
 * 编辑器布局检查（D-047）：DOM 顺序 + 对齐 + 文案。
 *   node packages/demo/src/verify-editor-layout.mjs
 */
import { readFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripTemp } from './strip-to-temp.mjs';

const ROOT = normalize(join(fileURLToPath(new URL('.', import.meta.url)), '../../..'));
const BASE = 'http://127.0.0.1:5178';

class ClassList {
  constructor() { this.set = new Set(); }
  add(...c) { c.forEach((x) => this.set.add(x)); }
  remove(...c) { c.forEach((x) => this.set.delete(x)); }
  contains(c) { return this.set.has(c); }
}
class Node {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase(); this.children = []; this.style = {}; this.dataset = {};
    this.classList = new ClassList(); this._text = ''; this._html = ''; this._listeners = {};
    this.value = ''; this.checked = false; this.options = []; this.draggable = false;
    this.type = ''; this.className = '';
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
    if (t === 'click' && typeof this.onclick === 'function') this.onclick(e);
  }
  querySelector() { return null; }
  get firstChild() { return this.children[0] ?? null; }
}
class TextNode { constructor(t) { this._text = t; } get textContent() { return this._text; } }

const html = await readFile(join(ROOT, 'packages/demo/public/index.html'), 'utf8');
const registry = {};
{
  const re = /<([a-zA-Z][\w-]*)\b[^>]*\bid="([^"]+)"[^>]*>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const n = new Node(m[1]);
    const v = m[0].match(/\bvalue="([^"]*)"/);
    if (v) n.value = v[1];
    registry['#' + m[2]] = n;
  }
}
const document = {
  createElement: (t) => new Node(t), createTextNode: (t) => new TextNode(t),
  querySelector: (s) => registry[s] ?? null, body: new Node('body'),
};
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => realFetch(String(url).startsWith('/') ? BASE + url : url, init);
globalThis.document = document; globalThis.window = globalThis;

const { transpile } = await import(new URL('./transpile.mjs', import.meta.url).href);
const core = await stripTemp(ROOT, 'packages/core/src/index.ts', transpile);
const adapter = await stripTemp(ROOT, 'packages/data/src/adapter.ts', transpile);
const C = ['compute', 'critAverage', 'critTiers', 'DOT_TYPES', 'METRIC_OPTIONS', 'totalProcChance', 'isKuvaFamily'];
const A = ['arcaneToContributions', 'isConditionOverloadMod', 'isModCompatibleWithWeapon', 'modKindsFor', 'modToContributions'];
let src = await readFile(join(ROOT, 'packages/demo/public/app.js'), 'utf8');
src = src.replace(/^import\s*\{[\s\S]*?\}\s*from\s*'\.\.\/\.\.\/core\/src\/index\.ts';/m, '');
src = src.replace(/^import\s*\{[\s\S]*?\}\s*from\s*'\.\.\/\.\.\/data\/src\/adapter\.ts';/m, '');
src = C.map((n) => `const ${n} = __core.${n};`).join('\n') + '\n'
  + A.map((n) => `const ${n} = __adapter.${n};`).join('\n') + '\n' + src;
await new Function('__core', '__adapter', 'document', 'window', 'fetch', 'setTimeout', 'clearTimeout', 'console', src)(
  core, adapter, document, globalThis, globalThis.fetch, setTimeout, clearTimeout, console);
await new Promise((r) => setTimeout(r, 600));

// 打开编辑器
registry['#open-editor'].fire('click');
const body = registry['#editor-body'];

const checks = [];
const check = (n, p) => checks.push([n, Boolean(p)]);

/** 按类名递归收集 */
function collect(node, cls, out = []) {
  for (const c of node.children) {
    if ((c.className || '').split(/\s+/).includes(cls)) out.push(c);
    collect(c, cls, out);
  }
  return out;
}
/** 直接子节点里按类名找 */
function childByClass(node, cls) {
  return node.children.find((c) => (c.className || '').split(/\s+/).includes(cls));
}
function indexOfChild(node, child) { return node.children.indexOf(child); }

// ── 1. 发射器类型在模式元信息行内（D-048：触发几率不再重复出现在这里）──
const metaRows = collect(body, 'editor-meta-row');
check('有模式元信息行', metaRows.length >= 1);
if (metaRows.length) {
  const fields = metaRows[0].children.filter((c) => (c.className || '').includes('editor-field'));
  check('元信息行只有 1 个字段（发射器类型）', fields.length === 1);
  check('该字段是发射器类型', fields[0] && fields[0].textContent.includes('发射器类型'));
  check('模式区不再有触发几率', !metaRows[0].textContent.includes('触发几率'));
}

// ── 1b. 触发几率只在「面板数值」区出现一次 ──
{
  const text = body.textContent;
  const occurrences = (text.match(/触发几率/g) || []).length;
  // D-050：面板数值下沉到模式级，每个模式各有一份，所以出现次数 = 模式数
  check('每个模式各一份触发几率（不再跨模式重复）', occurrences === 1);
  const sectionTitles = body.children
    .filter((c) => (c.className || '').includes('editor-section'))
    .map((c) => c.textContent);
  // D-050：模式在最上面（不同模式的面板可能不同）
  check('第一个分区是模式而不是面板数值', sectionTitles[0] && sectionTitles[0].startsWith('模式：'));
  check('模式分区在最上（只有一个模式时也如此）', sectionTitles.length === 1);
  // 面板数值应位于模式分区之内（紧跟在模式标题后）
  const secIdx = body.children.findIndex((c) => (c.className || '').includes('editor-section'));
  const gridIdx = body.children.findIndex((c) => (c.className || '').includes('editor-grid'));
  check('面板数值紧跟模式标题', gridIdx === secIdx + 1);
}

// ── 1c. 发射器类型带中文与括号说明（D-048）──
{
  const sel = collect(body, 'editor-meta-row')[0].children.find(
    (c) => (c.tagName || '') === 'LABEL')?.children.find((c) => (c.tagName || '') === 'SELECT');
  check('找到触发类型下拉', Boolean(sel));
  if (sel) {
    const labels = sel.children.map((o) => o.textContent);
    check('下拉有 9 个选项', labels.length === 9);
    check('选项是中文名+括号解释', labels.every((t) => /^[^（]+（.+）$/.test(t)));
    check('全自动的解释正确', labels.includes('全自动（按住持续射击）'));
    check('未标注的解释正确', labels.some((t) => t.startsWith('未标注（')));
    // 选项的 value 仍是英文原值
    const values = sel.children.map((o) => o.value);
    check('value 保留英文原值', values.includes('auto') && values.includes('charged'));
  }
}

// ── 2. 「添加伤害类型」在面板总伤**上方** ──
const addRow = collect(body, 'editor-add-row')[0];
const addBtn = addRow;
const totalBox = collect(body, 'editor-total')[0];
check('存在添加伤害类型按钮', Boolean(addBtn));
check('存在面板总伤', Boolean(totalBox));
if (addBtn && totalBox) {
  const topLevel = body.children;
  check('添加按钮在总伤之前', indexOfChild(body, addBtn) < indexOfChild(body, totalBox));
}

// ── 3. 伤害分布在元信息行之后、添加按钮之前 ──
const dmgSub = collect(body, 'editor-sub')[0];
check('伤害分布标题存在', Boolean(dmgSub));
if (dmgSub && addBtn) {
  check('顺序为 元信息行 → 伤害分布 → 添加按钮 → 总伤',
    indexOfChild(body, metaRows[0]) < indexOfChild(body, dmgSub) &&
    indexOfChild(body, dmgSub) < indexOfChild(body, addBtn));
}

// ── 3b. 添加伤害类型是一个下拉选择，而不是固定顺序（D-049）──
{
  const sel = addRow.children.find((c) => (c.className || '').includes('editor-add-select'));
  check('添加区有 select', Boolean(sel) && sel.tagName === 'SELECT');
  if (sel) {
    const values = sel.children.map((o) => o.value);
    // 卡拉克预设里已有 impact/puncture/slash，可选类型应排除它们
    check('可选类型不含已存在的 impact/puncture/slash',
      !values.includes('impact') && !values.includes('puncture') && !values.includes('slash'));
    check('可选类型里含 heat（可以主动选它）', values.includes('heat'));
    check('可选类型里含 toxin', values.includes('toxin'));
    // 绝大多数是中文名；tau 官方就叫「Tau」，允许这一项是英文
    check('可选项显示为中文名（tau 除外）',
      sel.children.every((o) => /[\u4e00-\u9fa5]/.test(o.textContent) || o.value === 'tau'));
    check('多个可选项（不是只能加一种）', values.length > 1);

    // 选一个非首位的类型，点添加 → 应该加进去的是被选中的那个
    const target = values[values.length - 1];
    sel.value = target;
    const btn = addRow.children.find((c) => (c.className || '').includes('btn-ghost'));
    check('找到添加按钮', Boolean(btn));
    if (btn) {
      btn.fire('click');
      // 重新收集编辑器内容，确认新增的类型是 target 而不是 avail[0]
      const body2 = registry['#editor-body'];
      const nameOfTarget = sel.children.find((o) => o.value === target).textContent;
      const dmgRows = collect(body2, 'editor-dmg-row');
      const names = dmgRows.map((r) => r.textContent);
      check('加进去的是所选的类型（' + nameOfTarget + '）',
        names.some((t) => t.includes(nameOfTarget)));
    }
  }
}

// ── 4. 括号提示已去掉 ──
const bodyText = body.textContent;
check('总伤不再带括号说明', !bodyText.includes('由分布自动求和'));
check('不再出现「（由」样式提示', !bodyText.includes('由分布自动求和，不可编辑'));

// ── 5. CSS 对齐规则 ──
const css = await readFile(join(ROOT, 'packages/demo/public/app.css'), 'utf8');
check('editor-field 不再 space-between', !/\.editor-field\s*\{[^}]*space-between/.test(css));
check('有 .editor-meta-row 规则', css.includes('.editor-meta-row'));
check('有 .editor-add-row 规则', css.includes('.editor-add-row'));
check('添加区有下拉选择器', css.includes('.editor-add-select'));
check('editor-total 规则只有一条', (css.match(/\.editor-total \{/g) || []).length === 1);

// ── 6. 词条名等宽 + 纵向节奏统一（D-051）──
{
  const labelRule = css.match(/\.editor-label \{[^}]*\}/);
  const dmgNameRule = css.match(/\.editor-dmg-name \{[^}]*\}/);
  check('有 .editor-label 规则', Boolean(labelRule));
  check('有 .editor-dmg-name 规则', Boolean(dmgNameRule));

  // 两者必须用同一个固定宽度
  const w1 = labelRule && labelRule[0].match(/width:\s*(\d+)px/);
  const w2 = dmgNameRule && dmgNameRule[0].match(/width:\s*(\d+)px/);
  check('词条名使用固定宽度', Boolean(w1) && Boolean(w2));
  check('两类词条名宽度一致', w1 && w2 && w1[1] === w2[1]);
  check('宽度不再依赖 min-width（那样会随内容伸缩）',
    !/min-width:\s*\d+px/.test((dmgNameRule || [''])[0]));

  // 纵向节奏：分区标题上间隔 > 分区内元素间隔
  const secRule = css.match(/\.editor-section \{[^}]*\}/)[0];
  const secTop = secRule.match(/margin:\s*(\d+)px/);
  check('分区标题有较大的上间隔（≥18px）', secTop && Number(secTop[1]) >= 18);

  const subRule = css.match(/\.editor-sub \{[^}]*\}/)[0];
  const gridRule = css.match(/\.editor-grid \{[^}]*\}/)[0];
  check('伤害分布小标题有独立间隔', /margin:\s*\d+px 0 \d+px/.test(subRule));
  check('面板数值网格行间距 ≥10px', /gap:\s*\d+px\s+\d+px/.test(gridRule) &&
    Number(gridRule.match(/gap:\s*(\d+)px/)[1]) >= 10);
}

let ok = true;
for (const [n, p] of checks) { if (!p) ok = false; console.log(`${p ? '✔' : '✖'} ${n}`); }
console.log(`\n共 ${checks.length} 项，${checks.filter((c) => c[1]).length} 通过`);
process.exit(ok ? 0 : 1);
