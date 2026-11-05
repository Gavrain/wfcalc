/**
 * 端到端（D-050）：模式级 override 保存后，页面上的暴击数据确实跟着变。
 *   node packages/demo/src/verify-mode-panel-e2e.mjs   （需 demo 服务在跑）
 */
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripTemp } from './strip-to-temp.mjs';

const ROOT = normalize(join(fileURLToPath(new URL('.', import.meta.url)), '../../..'));
const BASE = 'http://127.0.0.1:5178';
const OVERRIDES = join(ROOT, 'packages/data/src/manual/weapon-overrides.json');
const backup = existsSync(OVERRIDES) ? await readFile(OVERRIDES, 'utf8') : null;

const checks = [];
const check = (n, p) => checks.push([n, Boolean(p)]);

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

async function bootAndReadCrit() {
  const html = await readFile(join(ROOT, 'packages/demo/public/index.html'), 'utf8');
  const registry = {};
  const re = /<([a-zA-Z][\w-]*)\b[^>]*\bid="([^"]+)"[^>]*>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const n = new Node(m[1]);
    const v = m[0].match(/\bvalue="([^"]*)"/);
    if (v) n.value = v[1];
    registry['#' + m[2]] = n;
  }
  const document = {
    createElement: (t) => new Node(t), createTextNode: (t) => new TextNode(t),
    querySelector: (s) => registry[s] ?? null, body: new Node('body'),
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) =>
    realFetch(String(url).startsWith('/') ? BASE + url : url, init);
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
  globalThis.fetch = realFetch;

  const rows = registry['#panel-table'].children;
  const critRow = rows.find((r) => r.textContent.includes('暴击几率'));
  const cdRow = rows.find((r) => r.textContent.includes('暴击伤害'));
  return { crit: critRow ? critRow.textContent : '', cd: cdRow ? cdRow.textContent : '' };
}

try {
  try { await unlink(OVERRIDES); } catch { /* */ }
  const before = await bootAndReadCrit();
  check('基线暴击几率 23%', before.crit.includes('23.00%'));

  // 给 primary 模式写一份 override：暴击 23% → 45%
  const payload = {
    weaponId: 'KuvaKarak',
    modes: [{
      id: 'primary', role: 'normal', trigger: 'auto', procChance: 0.31,
      override: { critChance: 0.45 },
      segments: [{ kind: 'impact', aoe: false, damage: { impact: 7.13, puncture: 6.21, slash: 9.66 }, procChance: 0.31 }],
    }],
  };
  const r = await fetch(`${BASE}/__save-weapon`, {
    method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload),
  });
  check('保存成功', r.ok);

  const after = await bootAndReadCrit();
  // 预设里有点击类 Mod 加成，基础面板应变成 45%
  check('模式级 override 生效（基础面板显示 45%）', after.crit.includes('45.00%'));
  check('暴击数据确实变了', after.crit !== before.crit);
} finally {
  if (backup === null) { try { await unlink(OVERRIDES); } catch { /* */ } }
  else await writeFile(OVERRIDES, backup, 'utf8');
}

let ok = true;
for (const [n, p] of checks) { if (!p) ok = false; console.log(`${p ? '✔' : '✖'} ${n}`); }
console.log(`\n共 ${checks.length} 项，${checks.filter((c) => c[1]).length} 通过`);
process.exit(ok ? 0 : 1);
