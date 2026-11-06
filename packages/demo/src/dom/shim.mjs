/**
 * minimal DOM shim（D-103 从 3 份重复实现里抽出）。
 *
 * 为什么不去装 jsdom：沙箱里 npm 不能联网装包；这里只需要够跑 `app.js` 的
 * `document.querySelector` / `createElement` / `addEventListener` / `fire`。
 *
 * 关键：`buildRegistry()` 是**从真实 index.html 解析 id**，
 * 页面上没有的 id 在这里也不存在 —— 之前手写 id 列表导致"假 DOM 全绿、真浏览器报 null"。
 */

export class ClassList {
  constructor() { this.set = new Set(); }
  add(...c) { c.forEach((x) => this.set.add(x)); }
  remove(...c) { c.forEach((x) => this.set.delete(x)); }
  contains(c) { return this.set.has(c); }
  toggle(c, on) {
    const want = on === undefined ? !this.set.has(c) : Boolean(on);
    if (want) this.set.add(c); else this.set.delete(c);
    return want;
  }
  toString() { return [...this.set].join(' '); }
}

export class TextNode {
  constructor(t) { this._text = String(t); }
  get textContent() { return this._text; }
}

export class NumNode extends TextNode {
  constructor(v) { super(String(v)); this.value = v; }
  get textContent() { return String(this.value); }
}

/**
 * 一个够用的 Element。**故意不做完整 DOM**：
 * 只实现 app.js 真正用到的部分，缺什么补什么（补的时候想清楚真实浏览器的行为）。
 */
export class Node {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.style = {};
    this.dataset = {};
    this.classList = new ClassList();
    this._text = '';
    this._html = '';
    this._listeners = {};
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.options = [];
    this.draggable = false;
    this.type = '';
    this.className = '';
    this.id = '';
    this.title = '';
    this.parentNode = null;
  }

  set textContent(v) { this._text = String(v); this.children = []; }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
  get innerHTML() { return this._html ?? ''; }
  set innerHTML(v) { this._html = v; if (v === '') { this.children = []; this._text = ''; } }

  append(...ns) {
    for (const n of ns) {
      const node = typeof n === 'string' ? new TextNode(n) : n;
      if (node && typeof node === 'object') node.parentNode = this;
      this.children.push(node);
    }
  }
  appendChild(n) { this.append(n); return n; }
  removeChild(n) {
    const i = this.children.indexOf(n);
    if (i >= 0) { this.children.splice(i, 1); n.parentNode = null; }
    return n;
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  setAttribute(k, v) { this[k] = v; if (k === 'class') this.className = String(v); }
  getAttribute(k) { return this[k] ?? null; }

  addEventListener(t, fn) { (this._listeners[t] ??= []).push(fn); }
  removeEventListener(t, fn) {
    const arr = this._listeners[t];
    if (!arr) return;
    const i = arr.indexOf(fn);
    if (i >= 0) arr.splice(i, 1);
  }

  /** 触发一个事件；`onxxx` 属性与 addEventListener 注册的都算 */
  fire(t, ev = {}) {
    const e = { target: this, currentTarget: this, preventDefault() {}, stopPropagation() {}, ...ev };
    if (!e.dataTransfer) e.dataTransfer = { setData() {}, getData() { return ''; }, effectAllowed: 'all', dropEffect: 'all' };
    for (const fn of this._listeners[t] ?? []) fn(e);
    // 真实 DOM 里 `el.onclick = fn` 等价于注册了一个监听器
    const handler = this['on' + t];
    if (typeof handler === 'function') handler(e);
  }

  querySelector() { return null; }
  querySelectorAll() { return []; }
  contains(n) {
    if (n === this) return true;
    for (const c of this.children) if (c instanceof Node && c.contains(n)) return true;
    return false;
  }
  get firstChild() { return this.children[0] ?? null; }
  get lastChild() { return this.children[this.children.length - 1] ?? null; }
}

/** 递归按类名收集（检查脚本常用） */
export function collect(node, cls, out = []) {
  for (const c of node.children ?? []) {
    if (String(c.className || '').split(/\s+/).includes(cls)) out.push(c);
    if (c instanceof Node) collect(c, cls, out);
  }
  return out;
}

/** 递归按标签名找第一个 */
export function findDeep(node, tag) {
  if (!node) return null;
  if (node.tagName === String(tag).toUpperCase()) return node;
  for (const c of node.children ?? []) {
    const hit = findDeep(c, tag);
    if (hit) return hit;
  }
  return null;
}

/**
 * 从真实 index.html 建 `#id → Node` 注册表。
 *
 * 额外做的两件小事（真实 DOM 里本来就成立）：
 *   · `<select>` 的静态 `<option>` 挂到对应的 select 下；
 *   · `type="checkbox" / "range"` 记下来（检查脚本要看）。
 */
export async function buildRegistry(readText, htmlPath) {
  const html = await readText(htmlPath);
  const reg = {};
  const re = /<([a-zA-Z][\w-]*)\b[^>]*\bid="([^"]+)"[^>]*>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const node = new Node(m[1]);
    node.id = m[2];
    if (/\btype="checkbox"/.test(m[0])) node.type = 'checkbox';
    if (/\btype="range"/.test(m[0])) node.type = 'range';
    const v = m[0].match(/\bvalue="([^"]*)"/);
    if (v) node.value = v[1];
    const cls = m[0].match(/\bclass="([^"]*)"/);
    if (cls) node.className = cls[1];
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
      o.parentNode = sel;
      sel.children.push(o);
    }
    if (!sel.value && sel.children.length) sel.value = sel.children[0].value;
  }
  return { registry: reg, html };
}

/** 造一个喂给 app.js 的 `document` */
export function makeDocument(registry) {
  return {
    createElement: (t) => new Node(t),
    createElementNS: (_ns, t) => new Node(t),
    createTextNode: (t) => new TextNode(t),
    querySelector: (s) => registry[s] ?? null,
    querySelectorAll: () => [],
    getElementById: (id) => registry['#' + id] ?? null,
    body: new Node('body'),
    head: new Node('head'),
    documentElement: new Node('html'),
  };
}
