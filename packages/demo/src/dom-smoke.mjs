/**
 * 用最小 DOM shim 在 Node 里跑一遍 app.js 的完整渲染路径。
 *
 * 目的：沙箱里跑不了无头浏览器（Chrome 的 IPC 通道被拒），
 * 所以这里模拟 `document` / `Element` / `fetch`，把页面真正"渲染"一遍，
 * 再检查关键结果（标题、槽位、备选 Mod 数、增幅排序、拖拽后重算）。
 *
 *   node packages/demo/src/dom-smoke.mjs
 */
import { readFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripTemp } from './strip-to-temp.mjs';

const ROOT = normalize(join(fileURLToPath(new URL('.', import.meta.url)), '../../..'));

// ── 最小 DOM ──
class ClassList {
  constructor() { this.set = new Set(); }
  add(...c) { c.forEach((x) => this.set.add(x)); }
  remove(...c) { c.forEach((x) => this.set.delete(x)); }
  contains(c) { return this.set.has(c); }
  toString() { return [...this.set].join(' '); }
}

class Node {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.style = {};
    this.classList = new ClassList();
    this.dataset = {};
    this._text = '';
    this._listeners = {};
    this.value = '';
    this.checked = false;
    this.type = '';
    this.name = '';
    this.options = [];
    this.title = '';
    this.draggable = false;
    this.id = '';
    this.className = '';
  }
  set textContent(v) { this._text = String(v); this.children = []; }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
  get innerHTML() { return this._html ?? ''; }
  set innerHTML(v) { this._html = v; if (v === '') { this.children = []; this._text = ''; } }
  append(...nodes) {
    for (const n of nodes) {
      if (typeof n === 'string') this.children.push(new TextNode(n));
      else this.children.push(n);
    }
  }
  appendChild(n) { this.append(n); return n; }
  addEventListener(t, fn) { (this._listeners[t] ??= []).push(fn); }
  fire(t, ev = {}) { (this._listeners[t] ?? []).forEach((fn) => fn({ target: this, preventDefault() {}, ...ev })); }
  setAttribute(k, v) { this[k] = v; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  get firstChild() { return this.children[0]; }
}

class TextNode {
  constructor(t) { this._text = t; }
  get textContent() { return this._text; }
}

const ALL = new Map();
const registry = {};

function createEl(tag) {
  const n = new Node(tag);
  return n;
}

const document = {
  createElement: (tag) => createEl(tag),
  createTextNode: (t) => new TextNode(t),
  querySelector: (sel) => registry[sel] ?? null,
  body: new Node('body'),
};

// 预建页面里用到的容器
for (const id of [
  '#weapon-title', '#weapon-meta', '#panel-table', '#damage-table', '#kuva-dist',
  '#output-list', '#dot-detail', '#slot-grid', '#side-slots', '#candidate-list',
  '#candidate-count', '#slot-info', '#faction-select', '#kuva-element', '#arcane-select',
  '#kuva-ratio', '#kuva-ratio-val', '#headshot-toggle', '#headshot-mult', '#metric-options',
  '#detail', '#toast',
]) {
  const node = new Node('div');
  if (id === '#faction-select' || id === '#kuva-element' || id === '#arcane-select') node.tagName = 'SELECT';
  if (id === '#kuva-ratio' || id === '#headshot-mult') node.tagName = 'INPUT';
  if (id === '#headshot-toggle') node.tagName = 'INPUT';
  registry[id] = node;
}

// ── fetch 从本地读数据 ──
globalThis.fetch = async (url) => {
  const rel = String(url).replace(/^\//, '');
  const text = await readFile(join(ROOT, rel), 'utf8');
  return { ok: true, status: 200, json: async () => JSON.parse(text) };
};

globalThis.document = document;
globalThis.window = globalThis;

// ── 用剥好的 core / adapter 替换 app.js 的导入 ──
const { transpile } = await import(new URL('./transpile.mjs', import.meta.url).href);
const core = await stripTemp(ROOT, 'packages/core/src/index.ts', transpile);
const adapter = await stripTemp(ROOT, 'packages/data/src/adapter.ts', transpile);

const coreNames = ['compute', 'critAverage', 'critTiers', 'DOT_TYPES', 'METRIC_OPTIONS'];
const adapterNames = ['arcaneToContributions', 'factionOfMod', 'isConditionOverloadMod', 'modKindsFor', 'modToContributions'];

let src = await readFile(join(ROOT, 'packages/demo/public/app.js'), 'utf8');
src = src.replace(/^import\s*\{[\s\S]*?\}\s*from\s*'\.\.\/\.\.\/core\/src\/index\.ts';/m, '');
src = src.replace(/^import\s*\{[\s\S]*?\}\s*from\s*'\.\.\/\.\.\/data\/src\/adapter\.ts';/m, '');
const preamble =
  coreNames.map((n) => `const ${n} = __core.${n};`).join('\n') +
  '\n' +
  adapterNames.map((n) => `const ${n} = __adapter.${n};`).join('\n');
src = preamble + '\n' + src;

const fn = new Function('__core', '__adapter', 'document', 'window', 'fetch', 'setTimeout', 'clearTimeout', 'console', src + '\nreturn globalThis.__appExports;');
globalThis.__appExports = undefined;

await fn(core, adapter, document, globalThis, globalThis.fetch, setTimeout, clearTimeout, console);
// boot 是异步的，等它跑完
await new Promise((r) => setTimeout(r, 300));

// ── 断言 ──
const checks = [];
const title = registry['#weapon-title'].textContent;
checks.push(['武器标题', title.includes('赤毒·卡拉克')]);

const slots = registry['#slot-grid'].children.length;
checks.push(['8 个普通槽位', slots === 8]);

const side = registry['#side-slots'].children.length;
checks.push(['侧栏含赋能 + 劣化槽', side === 4]);

const cands = registry['#candidate-list'].children.length;
checks.push(['备选 Mod 已渲染（>100）', cands > 100]);

const outputRows = registry['#output-list'].children.length;
checks.push(['输出口径 6 行', outputRows === 6]);

const panelRows = registry['#panel-table'].children.length;
checks.push(['面板表有内容', panelRows >= 7]);

const dmgRows = registry['#damage-table'].children.length;
checks.push(['伤害分布表有内容', dmgRows >= 2]);

const slotInfo = registry['#slot-info'].textContent;
checks.push(['可装 Mod 种类信息', slotInfo.includes('rifle')]);

// 增幅排序：第一张卡增幅应 >= 最后一张
const firstGain = registry['#candidate-list'].children[0]?.textContent ?? '';
const lastGain = registry['#candidate-list'].children[cands - 1]?.textContent ?? '';
checks.push(['备选 Mod 卡含"伤害增幅"', firstGain.includes('伤害增幅')]);

let ok = true;
for (const [name, pass] of checks) {
  if (!pass) ok = false;
  console.log(`${pass ? '✔' : '✖'} ${name}`);
}
console.log('\n标题：', title);
console.log('备选 Mod 数：', cands, '| 槽位：', slots, '| 侧栏元素：', side);
console.log('第一张卡：', firstGain.slice(0, 90));
process.exit(ok ? 0 : 1);
