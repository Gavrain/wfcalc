/**
 * 把仓库里的 `.ts` 剥成临时 `.js` 后 import —— 只给验证脚本用。
 * （demo 本身不需要它：浏览器直接请求服务器剥好的文件。）
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const OUT_REL = '.demo-check';

export async function stripTemp(root, rel, transpile) {
  await stripWithDeps(root, rel, transpile, new Set());
  return import(pathToFileURL(join(root, OUT_REL, rel.replace(/\.ts$/, '.js'))).href);
}

async function stripWithDeps(root, rel, transpile, seen) {
  if (seen.has(rel)) return;
  seen.add(rel);

  const abs = join(root, rel);
  const src = await readFile(abs, 'utf8');

  const deps = [...src.matchAll(/from\s*['"](\.{1,2}\/[^'"]+)\.ts['"]/g)].map((m) => m[1]);
  for (const d of deps) {
    const depRel = relative(root, resolve(dirname(abs), d + '.ts')).split('\\').join('/');
    await stripWithDeps(root, depRel, transpile, seen);
  }

  const dest = join(root, OUT_REL, rel.replace(/\.ts$/, '.js'));
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, transpile(src), 'utf8');
}
