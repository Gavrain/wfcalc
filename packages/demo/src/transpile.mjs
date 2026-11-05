/**
 * `.ts` → 浏览器可执行 JS。
 *
 * 用 Node 内置的 `module.stripTypeScriptTypes()`（与 `--experimental-strip-types` 同一实现），
 * **不自己写正则剥类型**——之前用正则剥类型，注释里的花括号、多行声明都会踩坑。
 * `mode: 'transform'` 是为了兼容 `enum` / `namespace` 这类需真正编译的语法。
 *
 * 额外一步：浏览器要求相对导入**带扩展名且指向真实资源**。源码里写的是 `.ts`，
 * 所以这里把所有相对模块说明符的 `.ts` 统一改成 `.js`。
 *
 * ⚠ 必须覆盖**全部**带模块说明符的语法，之前只匹配 `from '...'` 与 `import('...')`，
 *   漏掉了 `export * from './x.ts'`——导致 bundle 里 index.js 仍指向 `./damage-types.ts`，
 *   浏览器按 `.ts` 去请求而服务器只亮 `.js`，整页 JS 404。
 *   现在改为「凡是紧跟引号的相对路径都改写」，并用 `moduleSpecifiers()` 做自检。
 */

import module from 'node:module';

const RELATIVE_TS = /(['"])(\.{1,2}\/[^'"]*?)\.ts\1/g;

/** 剥掉类型 + 把相对导入的 `.ts` 改成 `.js` */
export function transpile(src) {
  const stripped = stripTypeScriptTypes(src);
  return rewriteRelativeTs(stripped);
}

/** 只改写相对导入的 `.ts` → `.js`（纯 JS 文件用：demo 自己的前端代码） */
export function rewriteRelativeTs(code) {
  return code.replace(RELATIVE_TS, (_m, q, p) => `${q}${p}.js${q}`);
}

function stripTypeScriptTypes(src) {
  const strip = module.stripTypeScriptTypes;
  if (typeof strip !== 'function') {
    throw new Error(
      `当前 Node（${process.version}）没有 module.stripTypeScriptTypes，请使用 Node ≥ 22.13。`,
    );
  }
  return strip(src, { mode: 'transform' });
}

/**
 * 取出源码里所有相对模块说明符（用于依赖闭包检查 / 自检）。
 * 覆盖：`import ... from 'x'`、`export ... from 'x'`、`export * from 'x'`、`import('x')`。
 */
export function moduleSpecifiers(code) {
  const out = [];
  const re = /\bfrom\s*(['"])([^'"]+)\1|\bimport\s*\(\s*(['"])([^'"]+)\3/g;
  let m;
  while ((m = re.exec(code)) !== null) out.push(m[2] ?? m[4]);
  return out;
}

/** 自检：转译结果里不应再出现指向 `.ts` 的相对导入 */
export function findUnrewrittenTs(code) {
  return moduleSpecifiers(code).filter((s) => s.startsWith('.') && s.endsWith('.ts'));
}
