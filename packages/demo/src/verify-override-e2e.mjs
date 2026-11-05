/**
 * 端到端：保存 override → 页面加载后武器数据确实被改（D-046）。
 *   node packages/demo/src/verify-override-e2e.mjs   （需 demo 服务在跑）
 *
 * 做法：用 DOM shim 跑一次 app.js 的 boot，对比"有/无 override"两种情况下
 *       面板显示值是否不同。结束时恢复 overrides 文件。
 */
import { readFile, writeFile, unlink, readFile as rf } from 'node:fs/promises';
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

// ── DOM shim（与 dom-interact 同款，够跑 boot）──
class ClassList {
  constructor() { this.set = new Set(); }
  add(...c) { c.forEach((x) => this.set.add(x)); }
  remove(...c) { c.forEach((x) => this.set.delete(x)); }
  contains(c) { return this.set.has(c); }
}
class Node {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase(); this.children = []; this.style = {};
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

async function buildRegistry() {
  const html = await rf(join(ROOT, 'packages/demo/public/index.html'), 'utf8');
  const reg = {};
  const re = /<([a-zA-Z][\w-]*)\b[^>]*\bid="([^"]+)"[^>]*>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const n = new Node(m[1]);
    const v = m[0].match(/\bvalue="([^"]*)"/);
    if (v) n.value = v[1];
    reg['#' + m[2]] = n;
  }
  return reg;
}

/** 跑一次 app.js，返回面板当前值（暴击几率/射速行） */
async function bootAndReadPanel() {
  const registry = await buildRegistry();
  const document = {
    createElement: (t) => new Node(t), createTextNode: (t) => new TextNode(t),
    querySelector: (s) => registry[s] ?? null, body: new Node('body'),
  };
  // 走真实的 HTTP 服务（这样 /__dev 与 /__weapon-overrides 都是真的）
  // ⚠ 必须把 method/headers/body 一并透传，否则 POST 会退化成 GET
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) =>
    realFetch(String(url).startsWith('/') ? BASE + url : url, init);
  globalThis.document = document;
  globalThis.window = globalThis;

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

  // 恢复真实 fetch，避免影响后续（保存）请求
  globalThis.fetch = realFetch;

  // 读取「武器面板」里的暴击几率行
  const rows = registry['#panel-table'].children;
  const critRow = rows.find((r) => r.textContent.includes('暴击几率'));
  const speedRow = rows.find((r) => r.textContent.includes('射速'));
  return {
    crit: critRow ? critRow.textContent : '',
    speed: speedRow ? speedRow.textContent : '',
  };
}

try {
  // ── 基线（无 override）──
  try { await unlink(OVERRIDES); } catch { /* 本来就没有 */ }
  const before = await bootAndReadPanel();
  check('基线：暴击几率 23%', before.crit.includes('23.00%'));

  // ── 写入 override：暴击几率 23% → 30%，射速 11.6667 → 8 ──
  const payload = {
    weaponId: 'KuvaKarak',
    critChance: 0.30,
    fireRate: 8,
    note: 'e2e 测试',
    modes: [{
      id: 'primary', role: 'normal', trigger: 'auto', procChance: 0.31,
      segments: [{ kind: 'impact', aoe: false, damage: { impact: 7.13, puncture: 6.21, slash: 9.66 }, procChance: 0.31 }],
    }],
  };
  const saveRes = await fetch(`${BASE}/__save-weapon`, {
    method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload),
  });
  check('保存成功', saveRes.ok);

  const after = await bootAndReadPanel();
  check('页面已用上新的暴击几率（30%）', after.crit.includes('30.00%'));
  check('页面已用上新的射速（8）', after.speed.includes('8.000'));
  check('数值确实变了', after.crit !== before.crit && after.speed !== before.speed);

  // ── 恢复 ──
  if (backup === null) { try { await unlink(OVERRIDES); } catch { /* 已删除 */ } }
  else await writeFile(OVERRIDES, backup, 'utf8');

  const restored = await bootAndReadPanel();
  check('删除 override 后恢复原值', restored.crit.includes('23.00%'));
} finally {
  if (backup === null) { try { await unlink(OVERRIDES); } catch { /* */ } }
  else await writeFile(OVERRIDES, backup, 'utf8');
}

let ok = true;
for (const [n, p] of checks) {
  if (!p) ok = false;
  console.log(`${p ? '✔' : '✖'} ${n}`);
}
console.log(`\n共 ${checks.length} 项，${checks.filter((c) => c[1]).length} 通过`);
process.exit(ok ? 0 : 1);
