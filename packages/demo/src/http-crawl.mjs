/**
 * 模拟浏览器：从 index.html 出发，沿着模块依赖图把每个相对导入**真的 HTTP 请求一遍**，
 * 确认没有 404、且响应内容里不再出现指向 .ts 的导入。
 *
 *   node packages/demo/src/http-crawl.mjs     （需要 demo 服务器在跑）
 */
import { moduleSpecifiers } from './transpile.mjs';

const BASE = process.env.BASE ?? 'http://127.0.0.1:5178';
const START = '/packages/demo/public/app.js';

const visited = new Map(); // url -> {status, bytes}
const problems = [];
const queue = [START];

/** 以 BASE 为根，把 fromUrl（绝对路径）与相对说明符解析成新的绝对路径 */
function resolve(fromUrl, spec) {
  return new URL(spec, BASE + fromUrl).pathname;
}

let requests = 0;
while (queue.length) {
  const path = queue.shift();
  if (visited.has(path)) continue;
  requests++;
  let res;
  try {
    res = await fetch(BASE + path);
  } catch (e) {
    problems.push(`${path}: 请求失败 ${e.message}`);
    visited.set(path, { status: 0 });
    continue;
  }
  const text = await res.text();
  visited.set(path, { status: res.status, bytes: text.length });

  if (res.status !== 200) {
    problems.push(`${path}: HTTP ${res.status}`);
    continue;
  }

  // 相对导入里还残留 .ts → 浏览器一定会 404
  const leftovers = moduleSpecifiers(text).filter((s) => s.startsWith('.') && s.endsWith('.ts'));
  if (leftovers.length) problems.push(`${path}: 仍含 .ts 导入 ${leftovers.join(', ')}`);

  for (const spec of moduleSpecifiers(text)) {
    if (!spec.startsWith('.')) continue;
    queue.push(resolve(path, spec));
  }
}

const failed = [...visited.entries()].filter(([, v]) => v.status !== 200);
console.log(`请求 ${requests} 个模块文件`);
for (const [p, v] of visited) console.log(`  ${String(v.status).padStart(3)} ${String(v.bytes ?? 0).padStart(7)}  ${p}`);

if (problems.length || failed.length) {
  console.error('\n✖ 有问题：');
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}
console.log(`\n✔ ${visited.size} 个模块全部 200，无 .ts 残留`);
