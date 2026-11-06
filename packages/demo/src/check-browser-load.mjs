/**
 * 逐文件验证：`.ts` 剥类型后能否被 ECMAScript 解析器接受（= 浏览器能不能跑）。
 *
 *   node --experimental-vm-modules packages/demo/src/check-browser-load.mjs
 *
 * 三件事：
 *   1. 每个 .ts 剥完必须能通过 `vm.SourceTextModule` 解析；
 *   2. 用剥完的 core + adapter 跑一遍真实数据（赤毒·卡拉克冒烟）；
 *   3. app.js 也要能解析。
 */
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { join, dirname, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import vm from 'node:vm';

const ROOT = normalize(join(fileURLToPath(new URL('.', import.meta.url)), '../../..'));
const OUT = join(ROOT, '.demo-check');

/**
 * 需要检查的 `.ts` 文件。
 *
 * ⚠ 新增 core 的源文件时**必须同步这里**，否则浏览器加载链会缺文件 404。
 * 清单按 core/src/index.ts 的 `export * from` 顺序维护（index 依赖谁，这里就列谁）。
 */
const TS_FILES = [
  'packages/core/src/damage-types.ts',
  'packages/core/src/weapon.ts',
  'packages/core/src/contributions.ts',
  'packages/core/src/buckets.ts',
  'packages/core/src/weapon-state.ts',
  'packages/core/src/status-effects.ts',
  'packages/core/src/kuva.ts',
  'packages/core/src/main.ts',
  'packages/core/src/analysis.ts',
  'packages/core/src/index.ts',
  'packages/data/src/adapter.ts',
];

const { transpile, findUnrewrittenTs, moduleSpecifiers } = await import(
  pathToFileURL(join(ROOT, 'packages/demo/src/transpile.mjs')).href
);

let ok = true;
await rm(OUT, { recursive: true, force: true });

// 1. 解析检查 + 落盘 + **模块说明符全检**
//    曾经的 bug：`export * from './x.ts'` 没被改写成 `.js`，浏览器按 `.ts` 请求 → 整页 404。
//    这里对每个文件检查「转译后的相对导入是否全部以 .js 结尾」。
const allSpecifiers = [];
for (const rel of TS_FILES) {
  const src = await readFile(join(ROOT, rel), 'utf8');
  const code = transpile(src);
  try {
    new vm.SourceTextModule(code);
  } catch (err) {
    console.error(`✖ ${rel}: 解析失败 —— ${err.message}`);
    ok = false;
    continue;
  }
  const leftover = findUnrewrittenTs(code);
  if (leftover.length) {
    console.error(`✖ ${rel}: 相对导入仍是 .ts（浏览器会 404）—— ${leftover.join(', ')}`);
    ok = false;
    continue;
  }
  for (const s of moduleSpecifiers(code)) {
    if (s.startsWith('.')) allSpecifiers.push({ from: rel, spec: s });
  }
  const dest = join(OUT, rel.replace(/\.ts$/, '.js'));
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, code, 'utf8');
}
if (ok) {
  console.log(`✔ ${TS_FILES.length} 个 .ts 剥类型后可解析，且相对导入全部改写成 .js`);
}

// 1b. 依赖闭包：每个相对导入都要能落到真实文件（.ts 源或 .js 直接存在）
const missing = [];
for (const { from, spec } of allSpecifiers) {
  const base = join(ROOT, dirname(from), spec);
  const tsPath = base.replace(/\.js$/, '.ts');
  if (!existsSync(base) && !existsSync(tsPath)) missing.push(`${from} → ${spec}`);
}
if (missing.length) {
  console.error('✖ 有相对导入找不到目标文件：\n  ' + missing.join('\n  '));
  ok = false;
} else if (ok) {
  console.log(`✔ ${allSpecifiers.length} 个相对导入全部能解析到源文件`);
}

// 2. 真实数据冒烟
if (ok) {
  try {
    const core = await import(pathToFileURL(join(OUT, 'packages/core/src/index.js')).href);
    const adapter = await import(pathToFileURL(join(OUT, 'packages/data/src/adapter.js')).href);
    const { KuvaKarakSmoke } = await import(pathToFileURL(join(ROOT, 'packages/demo/src/smoke.mjs')).href);
    const perShot = await KuvaKarakSmoke(core, adapter);
    if (!Number.isFinite(perShot) || perShot <= 0) throw new Error(`冒烟值异常：${perShot}`);
    console.log(`✔ 赤毒·卡拉克冒烟通过：单次射击期望 ${perShot.toFixed(3)}`);
  } catch (err) {
    console.error('✖ 冒烟失败：', err.message);
    ok = false;
  }
}

// 3. app.js 解析
try {
  const code = await readFile(join(ROOT, 'packages/demo/public/app.js'), 'utf8');
  new vm.SourceTextModule(code);
  console.log('✔ app.js 可被解析');
} catch (err) {
  console.error('✖ app.js：', err.message);
  ok = false;
}

await rm(OUT, { recursive: true, force: true });
process.exit(ok ? 0 : 1);
