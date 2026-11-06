/**
 * 在 Node 里把 `packages/demo/public/` 的整页"跑起来"（D-103）。
 *
 * 做的事（**一次加载，多个检查脚本复用**）：
 *   1. 从真实 `index.html` 建 DOM shim 注册表；
 *   2. 把 `app.js` 的所有 `import … from '…'` 换成从传入的命名空间取值的 `const`，
 *      再用 `new Function` 执行（app.js 不是 ESM 二进制，剥掉 import 即可当脚本跑）；
 *   3. `boot()` 是顶层 await 的 `Promise.all`，加载完等一小段时间再交还控制权。
 *
 * ⚠ 之前这段逻辑在 dom-interact / verify-editor-layout / verify-override-e2e /
 *   verify-mode-panel-e2e 里**各抄了一份**，而且抄漏了 `weapon-picker.js` 与
 *   `weapon-override.js` 两个导入（D-103 修复的正是这个坑）。
 *   以后 app.js 新增导入时**只需要改这里一处**。
 */
import { readFile } from 'node:fs/promises';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildRegistry, makeDocument } from './shim.mjs';
import { stripTemp } from '../strip-to-temp.mjs';

const ROOT = normalize(join(fileURLToPath(new URL('.', import.meta.url)), '../../../..'));
const PUBLIC = join(ROOT, 'packages/demo/public');

export { ROOT, PUBLIC };

/**
 * 加载各依赖模块并返回 `{ __core, __adapter, __picker, __issues, __override }`。
 * `.ts` 用 `strip-to-temp.mjs` 剥类型；纯 `.js` 直接 import。
 *
 * D-105：页面拆成 app-store / app-data / app-compute / ui-editor 四个 ES 模块，
 * 它们会被内联进同一段脚本，所以这里也一并加载，供 import 替换使用。
 */
export async function loadModules() {
  const { transpile } = await import(pathToFileURL(join(ROOT, 'packages/demo/src/transpile.mjs')).href);
  const core = await stripTemp(ROOT, 'packages/core/src/index.ts', transpile);
  const adapter = await stripTemp(ROOT, 'packages/data/src/adapter.ts', transpile);
  const picker = await import(pathToFileURL(join(PUBLIC, 'weapon-picker.js')).href);
  const issues = await stripTemp(ROOT, 'packages/data/manual/weapon-issues.ts', transpile);
  const override = await import(pathToFileURL(join(PUBLIC, 'weapon-override.js')).href);
  const store = await import(pathToFileURL(join(PUBLIC, 'app-store.js')).href);
  const data = await import(pathToFileURL(join(PUBLIC, 'app-data.js')).href);
  const compute = await import(pathToFileURL(join(PUBLIC, 'app-compute.js')).href);
  const editor = await import(pathToFileURL(join(PUBLIC, 'ui-editor.js')).href);
  return { core, adapter, picker, issues, override, store, data, compute, editor, transpile };
}

/**
 * 把 `app.js` 的 import 全部换成"从命名空间取值的 const 声明"。
 *
 * 覆盖的写法：`import { … } from '…'`、`import { … } as x from '…'`、`import * as x from '…'`。
 */
export function inlineImports(src, ns) {
  /** 每个模块说明符 → 注入的命名空间变量名 */
  const NS_BY_SPEC = [
    [/core\/src\/index\.ts$/, 'ns.core'],
    [/data\/src\/adapter\.ts$/, 'ns.adapter'],
    [/weapon-picker\.js$/, 'ns.picker'],
    [/manual\/weapon-issues\.ts$/, 'ns.issues'],
    [/\/weapon-override\.js$/, 'ns.override'],
    [/\/app-store\.js$/, 'ns.store'],
    [/\/app-data\.js$/, 'ns.data'],
    [/\/app-compute\.js$/, 'ns.compute'],
    [/\/ui-editor\.js$/, 'ns.editor'],
  ];

  const unresolved = [];
  let out = src.replace(
    /^import\s*\{([\s\S]*?)\}\s*from\s*'([^']+)';/gm,
    (_all, names, spec) => {
      const hit = NS_BY_SPEC.find(([re]) => re.test(spec));
      if (!hit) { unresolved.push(spec); return ''; }
      return names
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => {
          const m = s.match(/^(\w+)(?:\s+as\s+(\w+))?$/);
          if (!m) return `/* 无法内联：${s} */`;
          return `const ${m[2] ?? m[1]} = ${hit[1]}.${m[1]};`;
        })
        .join('\n');
    },
  );
  // `import * as 名字 from '…'`
  out = out.replace(/^import \* as (\w+) from '([^']+)';/gm, (_all, local, spec) => {
    const hit = NS_BY_SPEC.find(([re]) => re.test(spec));
    if (!hit) { unresolved.push(spec); return ''; }
    return `const ${local} = ${hit[1]};`;
  });
  if (unresolved.length) {
    throw new Error(`app.js 里有未登记的导入，请在 dom/load-page.mjs 的 NS_BY_SPEC 里补上：${unresolved.join(', ')}`);
  }
  return out;
}

/**
 * 在 `loadPage()` 之后**再跑一次** `boot()`（= 模拟刷新页面）。
 *
 * app.js 自己的 `boot()` 是它的私有函数，外部拿不到；这里从剥过 import 的源码里
 * 把 `boot` 加进返回值，等价于"浏览器里重新加载一次脚本"。
 * 用在「重启后选单/槽位/输出仍能重建」这类回归上。
 */
export async function invokeBoot() {
  if (!lastBoot) throw new Error('invokeBoot() 必须在 loadPage() 之后调用');
  return lastBoot();
}

/** loadPage 会把提炼出的 boot 存这里 */
let lastBoot = null;

/**
 * 启动页面。
 *
 * @param opts.fetch  可选：替换 `fetch`（默认把 `/xxx` 转到 demo 服务 `http://127.0.0.1:5178`）
 * @param opts.waitMs 等 `boot()` 完成的时间（默认 300ms；编辑器等更慢的路径可调大）
 * @returns `{ registry, document, modules }`
 */
export async function loadPage(opts = {}) {
  const { registry, html } = await buildRegistry(readFile, join(PUBLIC, 'index.html'));
  const document = makeDocument(registry);
  const modules = opts.modules ?? (await loadModules());

  const BASE = process.env.BASE ?? 'http://127.0.0.1:5178';
  const realFetch = globalThis.fetch;
  globalThis.fetch = opts.fetch ?? (async (url, init) =>
    realFetch(String(url).startsWith('/') ? BASE + url : url, init));
  globalThis.document = document;
  globalThis.window = globalThis;

  let src = inlineImports(await readFile(join(PUBLIC, 'app.js'), 'utf8'), {
    core: modules.core,
    adapter: modules.adapter,
    picker: modules.picker,
    issues: modules.issues,
    override: modules.override,
  });
  // 把私有的 `async function boot()` 暴露成返回值，供 invokeBoot() 二次启动
  src += '\n;return { boot: boot };\n';

  const fn = new Function('ns', 'document', 'window', 'fetch', 'setTimeout', 'clearTimeout', 'console', src);
  const api = await fn(modules, document, globalThis, globalThis.fetch, setTimeout, clearTimeout, console);
  await new Promise((r) => setTimeout(r, opts.waitMs ?? 300));
  lastBoot = api?.boot ?? null;

  return { registry, document, modules, html, boot: api?.boot, restoreFetch: () => { globalThis.fetch = realFetch; } };
}

export { dirname };
