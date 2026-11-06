/**
 * 依次跑页面校对脚本，汇总成一行一项（沙箱里不能捕获子进程 stdout，所以在这里串行 import）。
 * 用法：node packages/demo/src/run-page-checks.mjs [文件…]
 */
import { pathToFileURL } from 'node:url';

const DEFAULT = [
  'packages/demo/src/checks/interact.mjs',
  'packages/demo/src/checks/mode-status.mjs',
  'packages/demo/src/checks/editor-layout.mjs',
  'packages/demo/src/checks/override-merge.mjs',
  'packages/demo/src/checks/editor-save.mjs',
  'packages/demo/src/checks/override-e2e.mjs',
  'packages/demo/src/checks/mode-panel.mjs',
  'packages/demo/src/checks/status-sync.mjs',
];

const files = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT;
const rows = [];
let bad = 0;

for (const f of files) {
  const buf = [];
  const log = console.log;
  const err = console.error;
  console.log = (...a) => buf.push(a.join(' '));
  console.error = (...a) => buf.push('ERR ' + a.join(' '));
  let code = 0;
  const realExit = process.exit;
  process.exit = (c) => { code = c; throw new Error('__PAGE_CHECK_EXIT__'); };
  try {
    await import(pathToFileURL(f).href + '?t=' + Date.now());
  } catch (e) {
    if (!String(e.message).startsWith('__PAGE_CHECK_EXIT__')) {
      buf.push('THROW ' + e.message);
      code = 1;
    }
  } finally {
    process.exit = realExit;
    console.log = log;
    console.error = err;
  }
  const summary = buf.filter((l) => l.includes('共 ')).pop() ?? '（无汇总）';
  const fails = buf.filter((l) => l.startsWith('✖'));
  rows.push(`${code === 0 ? '✔' : '✖'} ${f.replace('packages/demo/src/checks/', '')}  ${summary}`);
  for (const l of fails.slice(0, 8)) rows.push('     ' + l);
  if (code !== 0) bad++;
}

console.log(rows.join('\n'));
console.log(`\n页面校对：${files.length} 个脚本，${files.length - bad} 个通过`);
process.exitCode = bad ? 1 : 0;
