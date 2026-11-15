/**
 * 把 demo 打包成**一个能双击打开的单文件 HTML**（离线版，需求方 2026-11-14 确认）。
 *
 * 产出：`dist/wfcalc-standalone.html`
 *   · 样式、脚本、全部数据都在这一个文件里；
 *   · 双击就能用，不需要 Node、不需要起服务、不联网；
 *   · 「编辑」按钮在离线版里不出现（没有后端，保存不出去）。
 *
 * 为什么不直接内联 `<script type="module">`：
 *   Chrome / Edge 从 `file://` 打开页面时**禁止任何模块脚本**（内联的也算），页面白屏。
 *   所以这里把所有模块按依赖顺序摊成**一段普通脚本**，并把每个模块的
 *   `import { a as b } from 'x'` 换成 `const { a: b } = __ns['x'];`。
 *
 * 三块内容：
 *   A. demo 自己的模块（`packages/demo/public/*.js`）——纯文本改写 import；
 *   B. 计算/数据模块（`packages/core`、`data/src/adapter.ts`、`data/src/manual/riven.ts`）
 *      ——剥类型后包进 `__def(name, deps, factory)` 工厂，导出收进命名空间；
 *      它们的**求值顺序**交给 Node 决定（写出空壳模块真 import 一次），
 *      这样依赖、乃至循环依赖的顺序都与本地服务器一致；
 *   C. 9 个 JSON 数据文件 → `data:application/json;base64,…`。
 *
 * 用法：`npm run build:offline`
 * ⚠ 生成物是快照：改代码或更新数据后要重新跑一次。
 */
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
import module from 'node:module';

const ROOT = normalize(join(fileURLToPath(new URL('.', import.meta.url)), '../../../..'));
const PUBLIC = join(ROOT, 'packages/demo/public');
const INDEX = join(PUBLIC, 'index.html');
const OUT = join(ROOT, 'dist/wfcalc-standalone.html');
const TMP_DIR = join(ROOT, '.demo-check', `.offline-${process.pid}-${Date.now()}`);

/**
 * 会被浏览器请求的数据文件（与 `app-data.js` 的 `loadAllWeapons()` 一一对应）。
 * ⚠ 那里新增数据文件时要同步加到这里，否则单文件版会缺数据。
 */
const DATA_ROOTS = [
  '/packages/data/src/generated/mods/weapon-slots.json',
  '/packages/data/src/generated/mods/mods.json',
  '/packages/data/src/generated/mods/arcanes.json',
  '/packages/data/src/generated/weapons/primary.json',
  '/packages/data/src/generated/weapons/secondary.json',
  '/packages/data/src/generated/weapons/melee.json',
  '/packages/data/src/generated/weapons/archgun.json',
  '/packages/data/src/generated/weapons/archmelee.json',
  '/packages/data/src/generated/weapons/companion.json',
];

const isTs = (p) => p.endsWith('.ts');

/** 相对模块说明符 → 站点绝对路径（与 `server.mjs` 的解析口径一致） */
function resolveSpec(spec, fromFile) {
  if (spec.startsWith('./') || spec.startsWith('../')) {
    return '/' + relative(ROOT, normalize(join(dirname(fromFile), spec))).split('\\').join('/');
  }
  return spec;
}

/** 站点绝对路径 → 仓库里的真实文件（`.js` 请求回落到 `.ts`，和服务器一样） */
function sitePathToFile(sitePath) {
  const base = join(ROOT, sitePath.slice(1));
  if (existsSync(base)) return base;
  if (sitePath.endsWith('.js')) {
    const ts = base.slice(0, -3) + '.ts';
    if (existsSync(ts)) return ts;
  }
  return null;
}

/** 剥类型 + 把相对导入的 `.ts` 改成 `.js`（与本地服务器同一个函数） */
function stripTypes(src) {
  return module.stripTypeScriptTypes(src, { mode: 'transform' }).replace(
    /(['"])(\.{1,2}\/[^'"]*?)\.ts\1/g,
    (_m, q, p) => `${q}${p}.js${q}`,
  );
}

/**
 * 统一的「模块路径 → 仓库文件」解析。
 * 剥过类型的源码里，`./x.ts` 已经被改成 `./x.js`，但仓库里只有 `.ts`，
 * 所以**一律按文件的真实内容判断**（扩展名只是请求写法），不能按后缀分支处理。
 */
function moduleFile(sitePath) {
  const file = sitePathToFile(sitePath);
  if (!file) throw new Error(`模块找不到：${sitePath}`);
  return file;
}

/**
 * 相对说明符 → 规范站点路径。规范 = 「仓库里那个文件的真实相对位置」，与它被请求成
 * `.js` 还是 `.ts` 无关（剥类型后源码里写的是 `.js`，仓库里却是 `.ts`）。
 * 这样同一个文件只会有一个键：`index.ts` 与 `damage-types.ts` 的工厂之间不会「各说各话」。
 */
function siteOfModule(spec, fromFile) {
  const abs = resolveSpec(spec, fromFile);
  const file = sitePathToFile(abs);
  if (!file) throw new Error(`模块找不到：${abs}（来自 ${fromFile}）`);
  return '/' + relative(ROOT, file).split('\\').join('/');
}

/**
 * 一个文件的读法：`.ts` 走「剥类型 + 相对导入改回 `.js`」（与本地服务器逐字相同），
 * `.js` 原样读。
 */
async function readModule(sitePath) {
  const file = moduleFile(sitePath);
  const raw = await readFile(file, 'utf8');
  return { sitePath, file, code: isTs(file) ? stripTypes(raw) : raw };
}

/** 模块里的静态 import：说明符 + 解析后的**仓库文件**（去重用） */
function moduleImports(mod) {
  return importSpecs(mod.code).map((spec) => {
    const site = siteOfModule(spec, mod.file);
    return { spec, site, file: moduleFile(site) };
  });
}

// ─────────────────────────────────────────────────────────────
// 文本改写
// ─────────────────────────────────────────────────────────────

/**
 * 一个模块的静态模块说明符：`import … from 'x'`、`export … from 'x'`、`import 'x'`。
 * 三个都要 —— `core/src/index.ts` 只有 `export * from`，漏掉它整棵依赖树就断了。
 */
const MODULE_SPEC_RE = /^\s*(?:import\s+(?:[^'";]+\s+from\s*)?|export\s+(?:\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s*from\s*)(['"])([^'"]+)\1;$/gm;
function importSpecs(code) {
  return [...code.matchAll(MODULE_SPEC_RE)].map((m) => m[2]);
}

/** `{ a, b as c }` 的括号内容 → 结构绑定语法 `a, b: c` */
function bindingClause(clause, spec) {
  return clause.split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
    const m = /^([\w$]+)\s+as\s+([\w$]+)$/.exec(s);
    if (!m && !/^[\w$]+$/.test(s)) throw new Error(`看不懂的 import 绑定：${s}（来自 ${spec}）`);
    return m ? `${m[1]}: ${m[2]}` : s;
  }).join(', ');
}

/**
 * A. 页面模块：摊进一段普通脚本里，每个页面模块各自包进一个 IIFE，
 *    内部用共享的命名空间 `__ns` 互相取导出值：
 *      · `import {a, b as c} from 'x'` → `const { a, b: c } = __ns[规范路径]`
 *      · `import * as ns from 'x'`     → `const ns = __ns[规范路径]`
 *      · `export …`                    → 去掉关键字，末尾把导出的名字写进 `__ns[规范路径]`
 *    为什么不摊平：页面模块之间同名很正常（`app.js` 也 import 了 `WEAPON_GROUPS`，
 *    而 `weapon-picker.js` 自己导出的正是它），放进同一作用域会直接「重复声明」。
 *    说明符一律换成**规范站点路径**（`/packages/...`），与计算模块命名空间的键同一套写法。
 */
function rewriteDemoModule(code, sitePath) {
  // 构建期校验：页面模块 import 的名字，对方必须真的导出过
  // （改源码时漏导出、或 import 了只存在于类型里的名字，这里直接报错，不会拖到浏览器里才白屏）
  const requested = new Map(); // 依赖站点路径 → Set(名字)
  const withImports = code.replace(
    /^import\s+(?:\{([^}]*)\}|(\*\s+as\s+([\w$]+)))\s*from\s*(['"])([^'"]+)\4;$/gm,
    (_m, clause, _star, nsName, _q, spec) => {
      const key = siteOfModule(spec, sitePathToFile(sitePath));
      if (clause) {
        if (!requested.has(key)) requested.set(key, new Set());
        for (const s of clause.split(',').map((x) => x.trim()).filter(Boolean)) {
          const mm = /^([\w$]+)(?:\s+as\s+[\w$]+)?$/.exec(s);
          if (!mm) throw new Error(`看不懂的 import 绑定：${s}（来自 ${sitePath}）`);
          requested.get(key).add(mm[1]);
        }
      }
      const bind = nsName
        ? `const ${nsName} = __ns[${JSON.stringify(key)}];`
        : `const { ${bindingClause(clause, spec)} } = __ns[${JSON.stringify(key)}];`;
      return bind;
    },
  );

  const names = [];
  const withExports = withImports
    // `export const/let/var/function/class`：去掉关键字，名字记下来
    .replace(/^export\s+((?:async\s+)?function\*?|const|let|var|class)\s+([\w$]+)/gm, (_m, kind, name) => {
      names.push(name);
      return `${kind} ${name}`;
    })
    // `export interface`：纯类型，只去掉关键字
    .replace(/^export\s+interface\s/gm, 'interface ')
    // `export { a, b as c }`：名字记下来，整行去掉
    .replace(/^export\s+\{([^}]*)\};$/gm, (_m, list) => {
      for (const s of list.split(',').map((x) => x.trim()).filter(Boolean)) {
        const mm = /^([\w$]+)(?:\s+as\s+([\w$]+))?$/.exec(s);
        if (!mm) throw new Error(`看不懂的 export 绑定：${s}（来自 ${sitePath}）`);
        names.push(mm[2] || mm[1]);
      }
      return '';
    })
    // `export * from 'x'`：本仓库页面模块没用到
    .replace(/^export\s+\*\s+from\s*['"][^'"]+['"];$/gm, () => {
      throw new Error(`页面模块 ${sitePath} 用了 export *，离线打包要补规则`);
    });

  const body = withExports.replace(/^import\s*['"]\s*[^'"]*['"];$/gm, '');
  const exportLines = names
    .map((n) => `__reg(${JSON.stringify(sitePath)}, ${JSON.stringify(n)}, ${n});`)
    .join('\n');
  return {
    code: `// ── ${sitePath} ──\n__ns[${JSON.stringify(sitePath)}] = __ns[${JSON.stringify(sitePath)}] || {};\n(function () {\n'use strict';\n${body}\n${exportLines}\n})();`,
    names,
    imports: requested,
  };
}

/** 构建期校验：页面模块之间 import 的名字，都能在对方导出的名字里找到 */
function assertDemoImportsExist(rewritten) {
  for (const mod of rewritten.values()) {
    for (const [dep, wanted] of mod.imports) {
      const provided = rewritten.get(dep);
      if (!provided) continue; // 计算模块（core / adapter / riven 表）的导出由它们自己的工厂校验
      for (const name of wanted) {
        if (!provided.names.includes(name)) {
          throw new Error(`${mod.sitePath} 从 ${dep} 取用了 ${name}，但那边没有导出它`);
        }
      }
    }
  }
}

/** 构建期校验：页面模块从**计算模块**取的名字，对方真的导出了（含 `export *` 转发的） */
function assertLibImportsExist(rewritten) {
  const problems = [];
  for (const mod of rewritten.values()) {
    for (const [dep, wanted] of mod.imports) {
      if (rewritten.has(dep)) continue; // 页面之间的已在上面核对过
      const provided = libExportsOf(dep);
      for (const name of wanted) {
        if (!provided.has(name)) problems.push(`${mod.sitePath} 从 ${dep} 取用了 ${name}，但那边没有导出它`);
      }
    }
  }
  if (problems.length) {
    throw new Error('页面从计算模块取用的名字找不到（浏览器里会在用到那行时才报错）：\n  ' + problems.join('\n  '));
  }
}

/**
 * B. 计算模块 → `__def(spec, deps, function (__ns, M) {…})`。
 *    这些模块里没有动态 import；`export * from` 只出现在 index.ts，
 *    而各模块的导出名互不冲突，摊平后仍是同一个命名空间。
 */
function toFactory(code, spec) {
  const deps = [];
  const bindings = new Map(); // 依赖站点路径 → 结构绑定语法
  let body = code.replace(
    /^import\s+(?:\{([^}]*)\}\s*from\s*)?(['"])([^'"]+)\2;$/gm,
    (_m, clause, _q, dep) => {
      if (dep === 'node:module') return ''; // core 里那行只是取 stripTypeScriptTypes 的兜底
      // 剥类型后相对导入已经是 `.js`，落到站点路径时再按服务器的规则找 `.ts`；
      // 键统一写成规范站点路径（`/packages/core/src/x.ts`），与页面模块的 `__ns` 键同一套
      const site = siteOfModule(dep, sitePathToFile(spec));
      deps.push(site);
      if (clause) bindings.set(site, bindingClause(clause, dep));
      return '';
    },
  );

  const names = [];
  const reexports = []; // `export * from 'x'` 的目标：它们的导出也要算进本命名空间
  body = body
    // `export interface …`：纯类型，只去掉关键字（声明本身运行时无害）
    .replace(/^export\s+interface\s/gm, 'interface ')
    // `export const/let/var/function/class`：去掉关键字，名字收进命名空间
    // （`export type X = …` 这类别名在剥类型那一步已经没了，不用在这里处理）
    .replace(/^export\s+((?:async\s+)?function\*?|const|let|var|class)\s+([\w$]+)/gm, (_m, kind, name) => {
      names.push(name);
      return `${kind} ${name}`;
    })
    // `export { a, b as c }`：收进命名空间
    .replace(/^export\s+\{([^}]*)\};$/gm, (_m, list) => list.split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
      const mm = /^([\w$]+)(?:\s+as\s+([\w$]+))?$/.exec(s);
      if (!mm) throw new Error(`看不懂的 export 绑定：${s}（来自 ${spec}）`);
      return `M[${JSON.stringify(mm[2] || mm[1])}] = ${mm[1]};`;
    }).join(' '))
    // `export * from 'x'`：整条去掉，末尾再把目标命名空间的导出**转发**过来。
    // 这一条是 `core/src/index.ts` 的全部内容——不转发的话，从 index 取任何值都是 undefined。
    .replace(/^export\s+\*\s+from\s*['"]([^'"]+)['"];$/gm, (_m, dep) => {
      const site = siteOfModule(dep, sitePathToFile(spec));
      if (!deps.includes(site)) deps.push(site);
      reexports.push(site);
      return '';
    });

  const rest = body
    .replace(/^import\s[^\n]*;$/gm, '')
    .replace(/^export\s[^\n]*;$/gm, '');

  if (/^\s*(import|export)\b/m.test(rest)) {
    throw new Error(`模块 ${spec} 里还有没处理掉的 import / export，离线打包要补规则`);
  }
  if (/\bimport\s*\(/.test(rest)) throw new Error(`模块 ${spec} 用了动态 import，离线打包不支持`);

  const lines = [];
  for (const d of reexports) {
    lines.push(`for (var __k in __ns[${JSON.stringify(d)}]) { if (!(__k in M)) M[__k] = __ns[${JSON.stringify(d)}][__k]; }`);
  }
  for (const n of names) lines.push(`M[${JSON.stringify(n)}] = ${n};`);
  const prologue = deps.map((d) => (bindings.has(d)
    ? `const { ${bindings.get(d)} } = __ns[${JSON.stringify(d)}];`
    : `/* 只为顺序和存在性引用：${d} */`)).join(' ');
  return (
    `__def(${JSON.stringify(spec)}, ${JSON.stringify(deps)}, function (__ns, M) {\n` +
    `'use strict'; ${prologue}\n${rest}\n${lines.join('\n')}\n});`
  );
}

// ─────────────────────────────────────────────────────────────
// 计算模块的导出名（给页面模块的 import 做「名字真的存在吗」校验）
// ─────────────────────────────────────────────────────────────

const libExportsCache = new Map();

/**
 * 某个计算模块对外提供的名字（含 `export * from` 转发来的）。
 * 为什么要在打包时查：页面里 `import { dotGainForCandidate } from './app-compute.js'`
 * 如果那边没导出（或名字打错），浏览器只在**用到那一行时**才报 `xxx is not defined`，
 * 平时不显、某个口径下才炸（2026-11-14 需求方切到 N 秒口径时踩到的就是这种）。
 */
function libExportsOf(sitePath) {
  if (libExportsCache.has(sitePath)) return libExportsCache.get(sitePath);
  const file = moduleFile(sitePath);
  const raw = readFileSync(file, 'utf8');
  const code = isTs(file) ? stripTypes(raw) : raw;
  const names = new Set();
  for (const m of code.matchAll(/^export\s+(?:(?:async\s+)?function\*?|const|let|var|class)\s+([\w$]+)/gm)) names.add(m[1]);
  for (const m of code.matchAll(/^export\s+\{([^}]*)\};$/gm)) {
    for (const s of m[1].split(',').map((x) => x.trim()).filter(Boolean)) {
      const mm = /^([\w$]+)(?:\s+as\s+([\w$]+))?$/.exec(s);
      if (mm) names.add(mm[2] || mm[1]);
    }
  }
  libExportsCache.set(sitePath, names); // 先缓存再递归：core 里 `export *` 会绕回自身
  for (const m of code.matchAll(/^export\s+\*\s+from\s*['"]([^'"]+)['"];$/gm)) {
    for (const n of libExportsOf(siteOfModule(m[1], file))) names.add(n);
  }
  return names;
}

// ─────────────────────────────────────────────────────────────
// 求值顺序：由 Node 决定（依赖一定排在依赖它的模块之前，循环依赖也按 ESM 规则）
// ─────────────────────────────────────────────────────────────

/**
 * 依赖顺序（由 Node 决定）：空壳模块里只保留 import 行（避免顶层代码真的跑起来，
 * 如 adapter 的 `setComboMultiplier()`），让 Node 自己去解析、加载。
 *
 * 顺序的口径是「**文件本身**被 Node 执行」的先后，记录下来给它去重：
 *   ① 依 ESM 规则，依赖一定排在依赖它的模块之前（循环依赖也是 Node 给出的顺序）；
 *   ② 同一个文件只执行一次，所以同一个文件也只会出现在结果里一次（不按「路径写法」去重）。
 */
async function nodeEvalOrder(entrySpecs, demoByPath) {
  const order = [];
  const shells = new Map(); // 仓库文件 → 空壳临时文件（一个文件只有一个空壳）
  const tmpBySite = new Map(); // 站点路径 → 空壳临时文件

  async function materialize(sitePath) {
    if (tmpBySite.has(sitePath)) return tmpBySite.get(sitePath);
    const demo = demoByPath.get(sitePath);
    const mod = demo ?? (await readModule(sitePath));
    if (shells.has(mod.file)) {
      tmpBySite.set(sitePath, shells.get(mod.file));
      return shells.get(mod.file);
    }
    const tmp = join(TMP_DIR, `m${shells.size}.mjs`);
    shells.set(mod.file, tmp); // 先占位：循环依赖时不会无限递归
    tmpBySite.set(sitePath, tmp);

    const lines = [];
    for (const { site, file } of moduleImports(mod)) {
      const depShell = await materialize(site);
      lines.push(`import ${JSON.stringify(pathToFileURL(depShell).href)};`);
    }
    order.push(sitePath);
    // 空壳：只保留 import 行
    await writeFile(tmp, lines.join('\n') + '\nexport const __shell = true;\n', 'utf8');
    return tmp;
  }

  const entries = [];
  for (const s of entrySpecs) entries.push(await materialize(s));
  for (const e of entries) await import(pathToFileURL(e).href);
  return order;
}

/**
 * 求值顺序里同一个模块会被它的依赖者引用很多次；这里只保留第一次出现，
 * 结果里每个站点路径出现一次，且排在使用它的模块之前。
 */
function uniqueOrder(order) {
  const seen = new Set();
  return order.filter((p) => (seen.has(p) ? false : (seen.add(p), true)));
}

// ─────────────────────────────────────────────────────────────
// 主流程
// ─────────────────────────────────────────────────────────────

async function build() {
  const index = await readFile(INDEX, 'utf8');
  await mkdir(TMP_DIR, { recursive: true });
  try {
    // 1. index.html 里的模块脚本就是入口（目前是 weapon-picker.js + app.js）
    const entries = [...index.matchAll(/<script\s+type="module"\s+src="([^"]+)"><\/script>/g)].map((m) => m[1]);
    if (!entries.length) throw new Error('index.html 里没找到模块脚本');

    // 2. demo 自己的模块（顺着入口走依赖图，只收 packages/demo/public/ 下的）
    const demoByPath = new Map();
    async function walk(sitePath) {
      if (demoByPath.has(sitePath)) return;
      const mod = await readModule(sitePath);
      demoByPath.set(sitePath, mod);
      for (const { site } of moduleImports(mod)) {
        if (site.startsWith('/packages/demo/public/')) await walk(site);
      }
    }
    for (const e of entries) await walk(e);

    // 3. 求值顺序：Node 说了算。
    //    · 页面模块：从 index.html 的入口出发，取其中「页面目录」里的那些；
    //    · 计算模块：从页面 import 进来的每个模块出发（index.ts / adapter.ts / riven.ts 及其
    //      全部传递依赖）——只从入口走一遍是拿不到 index.ts 里面那层 main.ts → segment.ts 的。
    const allOrder = await nodeEvalOrder(entries, demoByPath);
    const evalOrder = allOrder.filter((p) => demoByPath.has(p));
    const libSeeds = [];
    for (const mod of demoByPath.values()) {
      for (const { site } of moduleImports(mod)) {
        if (!demoByPath.has(site) && !libSeeds.includes(site)) libSeeds.push(site);
      }
    }
    const libOrder = await nodeEvalOrder(libSeeds, new Map());
    const libs = uniqueOrder(libOrder.filter((p) => !demoByPath.has(p)));
    if (libs.length < 10) {
      throw new Error(`计算模块只找到 ${libs.length} 个，依赖图多半没走全（应为 core 全量 + adapter + riven 表）`);
    }

    // 4. 数据 → data:URL
    const dataMap = new Map();
    for (const p of DATA_ROOTS) {
      dataMap.set(p, `data:application/json;base64,${(await readFile(join(ROOT, p.slice(1)))).toString('base64')}`);
    }

    // 5. 计算模块 → __def 工厂
    const factories = [];
    for (const p of libs) factories.push(toFactory((await readModule(p)).code, p));

    // 6. 页面模块 → 各自一个 IIFE（顺序同 evalOrder；入口 app.js 的 boot() 在最后自己跑）
    const demoParts = [];
    const demoRewritten = new Map();
    for (const p of evalOrder) {
      const mod = demoByPath.get(p);
      if (!mod) continue;
      let code = mod.code;
      if (p.endsWith('/app-data.js')) {
        // 数据地址有三处：三处字面量 + 一处运行时拼（`GENERATED + '/weapons/' + k + '.json'`）。
        // 做法：字面量的整段换掉；运行时拼接的靠 `getJSON` 先查一张「路径 → data: 地址」的对照表。
        // 这样数据地址的**来源**（`GENERATED + '…'`）一行都不用改，静态服务器上照旧。
        code = code.replace(/getJSON\(GENERATED \+ '([^']*)'\)/g, (_all, rel) => {
          const url = dataMap.get('/packages/data/src/generated' + rel);
          if (!url) throw new Error(`数据文件没内联：${rel}（检查 DATA_ROOTS）`);
          return `getJSON(${JSON.stringify(url)})`;
        });
        const table = JSON.stringify(Object.fromEntries(DATA_ROOTS.map((key) => [key, dataMap.get(key)])));
        code = code.replace(
          /const getJSON = \(url\) => fetch\(url\)\.then\(\(r\) => r\.json\(\)\);/,
          `const __INLINE_DATA = ${table};\n` +
          'const getJSON = (url) => fetch(__INLINE_DATA[url] || url).then((r) => r.json());',
        );
        if (!code.includes('__INLINE_DATA')) {
          throw new Error('app-data.js 里没找到 getJSON 的定义，离线打包要补规则');
        }
      }
      // 离线版没有后端：编辑器探测一律「不是开发态」，编辑按钮不渲染
      code = code.replace(
        /fetch\('\/__dev'\)/g,
        "Promise.resolve({ json: () => Promise.resolve({ dev: false, canEdit: false }) })",
      );
      const rewritten = rewriteDemoModule(code, p);
      if (/^\s*(import|export)\s/m.test(rewritten.code)) {
        throw new Error(`模块 ${p} 还有没改写的 import / export`);
      }
      rewritten.sitePath = p;
      demoParts.push(rewritten.code);
      demoRewritten.set(p, rewritten);
    }
    // 页面模块互相取的名字，这里对照**原始源码**再核一遍（不看改写结果，避免改写本身干扰）。
    // 为什么：页面里 `import { dotGainForCandidate } from './app-compute.js'` 若那边没导出，
    // 浏览器只在**用到那一行时**才报 `xxx is not defined`——平时不显、切换某个口径才炸。
    const exportsInSource = (code) => {
      const out = [];
      for (const x of code.matchAll(/^export\s+(?:(?:async\s+)?function\*?|const|let|var|class)\s+([\w$]+)/gm)) out.push(x[1]);
      for (const x of code.matchAll(/^export\s+\{([^}]*)\};$/gm)) {
        for (const s of x[1].split(',').map((y) => y.trim()).filter(Boolean)) {
          const mm = /^([\w$]+)(?:\s+as\s+([\w$]+))?$/.exec(s);
          if (mm) out.push(mm[2] || mm[1]);
        }
      }
      return out;
    };
    const demoSource = new Map();
    for (const [p, mod] of demoByPath) demoSource.set(p, exportsInSource(mod.code));

    const problems = [];
    for (const [owner, mod] of demoByPath) {
      for (const m of mod.code.matchAll(/^import\s+(?:\{([^}]*)\}|(\*\s+as\s+([\w$]+)))\s*from\s*(['"])([^'"]+)\4;$/gm)) {
        const clause = m[1];
        if (!clause) continue;
        const dep = siteOfModule(m[5], mod.file);
        const provided = demoSource.has(dep) ? demoSource.get(dep) : [...libExportsOf(dep)];
        for (const s of clause.split(',').map((x) => x.trim()).filter(Boolean)) {
          const name = s.split(/\s+as\s+/)[0].trim();
          if (name && !provided.includes(name)) problems.push(`${owner} 从 ${m[5]} 取用了 ${name}，但那边没有导出它`);
        }
      }
    }
    if (problems.length) {
      throw new Error('页面取用的名字在对方模块里找不到（浏览器只在用到那一行时才报 xxx is not defined）：\n  '
        + [...new Set(problems)].join('\n  '));
    }
    // 上面那段没查出问题，也要确认它真的跑过（防止哪天真出问题时这里被悄悄跳过）
    process.stderr.write(`[离线打包] 已核对页面取名 ${demoByPath.size} 个模块，无缺失\n`);
    const script = [
      '/* wfcalc 离线单文件版 · 由 npm run build:offline 生成，勿手改 */',
      '(function () {',
      "'use strict';",
      'var __defs = [];',
      'function __def(name, deps, factory) { __defs.push({ name: name, deps: deps, factory: factory }); }',
      ...factories,
      'var __ns = {};',
      'function __reg(mod, name, value) {',
      '  if (value === undefined) throw new Error("离线包缺导出：" + mod + " → " + name);',
      '  __ns[mod][name] = value;',
      '}',
      'for (var __i = 0; __i < __defs.length; __i++) {',
      '  var __d = __defs[__i];',
      '  var __m = {};',
      '  for (var __j = 0; __j < __d.deps.length; __j++) {',
      '    if (!__ns[__d.deps[__j]]) throw new Error("依赖缺失：" + __d.deps[__j]);',
      '  }',
      '  __d.factory(__ns, __m);',
      '  __ns[__d.name] = __m;',
      '}',
      ...demoParts,
      '})();',
    ].join('\n');

    // 7. 自检：把内联脚本当**普通脚本**（不是模块）编译一遍——只编译不执行。
    //    脚本坏掉的话这里就报错，不用等到浏览器打开白屏才发现。
    try {
      new vm.Script(script.replace(/<\\\/script/gi, '</script'), { filename: 'wfcalc-standalone.inline.js' });
    } catch (err) {
      throw new Error(
        '生成的脚本语法检查失败（浏览器会白屏），请把下面这段反馈给开发者：\n' + String(err && err.stack || err),
      );
    }

    // 8. 拼 HTML：样式内联，模块脚本换成一段普通脚本
    const css = await readFile(join(PUBLIC, 'app.css'), 'utf8');
    let html = index
      .replace(/<link rel="stylesheet" href="\/app\.css"\s*\/>/, () => `<style>\n${css}\n</style>`)
      .replace(/\n\s*<script\s+type="module"\s+src="[^"]+"><\/script>/g, '');
    const safe = script.replace(/<\/script/gi, '<\\/script');
    html = html.replace('</body>', `  <script>\n${safe}\n  </script>\n  </body>`);

    await mkdir(dirname(OUT), { recursive: true });
    await writeFile(OUT, html, 'utf8');
    console.log(`已生成：${relative(ROOT, OUT)}`);
    console.log(`  体积 ${(Buffer.byteLength(html, 'utf8') / 1024).toFixed(0)} KB · 内联数据 ${DATA_ROOTS.length} 个文件 · 计算模块 ${libs.length} 个 · 页面模块 ${demoParts.length} 个`);
    console.log('  双击打开即可使用；改了代码或数据后重新跑一次 npm run build:offline。');
  } finally {
    await rm(TMP_DIR, { recursive: true, force: true });
  }
}

// 直接运行时才执行打包；被测试脚本 import 时只导出 build()（不产生副作用）
export { build };

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await build();
}
