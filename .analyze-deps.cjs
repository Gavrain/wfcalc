'use strict';
/**
 * 静态依赖分析：算出「要把这些函数搬进新模块，需要哪些 import」。
 *
 * 用法：
 *   node .analyze-deps.cjs renderPanel renderOutputs …
 *
 * 输出：
 *   · 新模块内部互相调用的（搬过去就有的）
 *   · 需要从其它模块引入的（含**从哪个模块**）
 *   · 需要注入的（外壳才有的、带副作用的状态/回调）
 *   · 找不到来源的（要人工看）
 */
const fs = require('fs');

const PUBLIC = 'packages/demo/public';
const targets = process.argv.slice(2);
if (!targets.length) {
  console.error('用法: node .analyze-deps.cjs <函数名…>');
  process.exit(1);
}

const appSrc = fs.readFileSync(`${PUBLIC}/app.js`, 'utf8');

/** 从 i 开始按花括号配对找函数体结束 */
function fnEnd(src, start) {
  let depth = 0, started = false;
  for (let k = start; k < src.length; k++) {
    const ch = src[k];
    if (ch === '{') { depth++; started = true; }
    else if (ch === '}') { depth--; if (started && depth === 0) return k; }
  }
  return start;
}

/** 取函数的完整源码 */
function fnSrc(name) {
  const re = new RegExp('^(?:export )?(?:async )?function ' + name + '\\(', 'm');
  const m = re.exec(appSrc);
  if (!m) return null;
  return appSrc.slice(m.index, fnEnd(appSrc, m.index) + 1);
}

// 收集各模块的导出
const MODULES = {};
for (const f of fs.readdirSync(PUBLIC)) {
  if (!/\.js$/.test(f)) continue;
  const s = fs.readFileSync(`${PUBLIC}/${f}`, 'utf8');
  const exps = new Set();
  for (const m of s.matchAll(/export (?:function|const|let) (\w+)/g)) exps.add(m[1]);
  for (const m of s.matchAll(/export \{([^}]*)\}/g)) {
    m[1].split(',').map((x) => x.trim().split(/\s+as\s+/).pop()).filter(Boolean).forEach((n) => exps.add(n));
  }
  MODULES[f] = exps;
}
// core / data 的导出
const coreIdx = fs.readFileSync('packages/core/src/index.ts', 'utf8');
const CORE = new Set();
for (const m of coreIdx.matchAll(/export (?:function|const|type) (\w+)/g)) CORE.add(m[1]);
for (const m of coreIdx.matchAll(/export \{([^}]*)\}/g)) m[1].split(',').map((x) => x.trim()).filter(Boolean).forEach((n) => CORE.add(n));

const adapter = fs.readFileSync('packages/data/src/adapter.ts', 'utf8');
const ADAPTER = new Set([...adapter.matchAll(/export (?:function|const) (\w+)/g)].map((m) => m[1]));

// 要被搬走的函数集合
const moved = new Map();
const missingFn = [];
for (const n of targets) {
  const s = fnSrc(n);
  if (!s) { missingFn.push(n); continue; }
  moved.set(n, s);
}
if (missingFn.length) console.log('⚠ app.js 里找不到:', missingFn.join(', '));

// 扫这些函数体里调用的标识符
const called = new Set();
for (const s of moved.values()) {
  for (const m of s.matchAll(/(?<![\w.$])([a-zA-Z_$][\w$]*)\s*\(/g)) called.add(m[1]);
}

const JS_BUILTIN = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'typeof',
  'Math', 'Object', 'Array', 'String', 'Number', 'Boolean', 'JSON', 'Set', 'Map', 'Promise',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent', 'decodeURIComponent',
  'setTimeout', 'clearTimeout', 'requestAnimationFrame', 'document', 'localStorage', 'console']);

// app.js 里定义的顶层函数与常量
const appFns = new Set([...appSrc.matchAll(/^(?:async )?function (\w+)/gm)].map((m) => m[1]));
const appConsts = new Set([...appSrc.matchAll(/^(?:const|let) (\w+)/gm)].map((m) => m[1]));

const needInternal = [];   // 一起搬过去的
const needImport = [];     // 从别的模块 import
const needInject = [];     // app.js 里定义的（模块化后应注入或另抽）
const unknown = [];

for (const n of called) {
  if (moved.has(n) || JS_BUILTIN.has(n)) continue;
  if (CORE.has(n)) { needImport.push(['core/src/index.ts', n]); continue; }
  if (ADAPTER.has(n)) { needImport.push(['data/src/adapter.ts', n]); continue; }
  let found = false;
  for (const [file, exps] of Object.entries(MODULES)) {
    if (exps.has(n)) { needImport.push([file.replace(/\.js$/, ''), n]); found = true; break; }
  }
  if (found) continue;
  if (appFns.has(n) || appConsts.has(n)) { needInject.push(n); continue; }
  unknown.push(n);
}

// 也扫被引用的常量（不带括号的）
const refConsts = new Set();
for (const s of moved.values()) {
  for (const m of s.matchAll(/(?<![\w.$])([A-Z][A-Z0-9_]{2,})(?![\w$])/g)) refConsts.add(m[1]);
}
for (const n of refConsts) {
  if (moved.has(n)) continue;
  let found = false;
  for (const [file, exps] of Object.entries(MODULES)) {
    if (exps.has(n)) { needImport.push([file.replace(/\.js$/, ''), n]); found = true; break; }
  }
  if (found) continue;
  if (appConsts.has(n)) needInject.push(n + '（常量）');
}

// 汇总按模块分组
const byModule = {};
for (const [mod, name] of needImport) {
  (byModule[mod] = byModule[mod] || []).push(name);
}

console.log('=== 一起搬走:', [...moved.keys()].join(', '));
console.log('\n=== 需要 import（按模块分组）');
for (const [mod, names] of Object.entries(byModule)) {
  console.log('  from ' + mod + ': ' + [...new Set(names)].sort().join(', '));
}
console.log('\n=== 需要注入 / 仍留在 app.js:', [...new Set(needInject)].sort().join(', ') || '（无）');
console.log('\n=== 找不到来源（人工确认）:', [...new Set(unknown)].sort().join(', ') || '（无）');
