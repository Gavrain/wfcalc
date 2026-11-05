/**
 * 导出武器分类清单，辅助核对 D-053 的分类设计。
 *   node packages/demo/src/report-weapon-taxonomy.mjs
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = normalize(join(fileURLToPath(new URL('.', import.meta.url)), '../../..'));
const GEN = join(ROOT, 'packages/data/src/generated');

const slots = JSON.parse(await readFile(join(GEN, 'mods/weapon-slots.json'), 'utf8')).weapons;

const CATEGORY_LABEL = {
  rifle: '步枪', shotgun: '霰弹枪', sniper: '狙击枪', bow: '弓箭', crossbow: '弩',
  launcher: '发射器', pistol: '手枪', dual_pistols: '双持手枪',
  shotgun_sidearm: '副手霰弹', glaive: '投掷战刃', assault_rifle: '突击步枪',
};

const files = ['primary', 'secondary'];
const lines = [];
lines.push('# 武器分类清单（自动生成）');
lines.push('');
lines.push('> 由 `npm run report:taxonomy` 生成，供 D-053 分类设计核对用。');
lines.push('');

for (const f of files) {
  const weapons = JSON.parse(await readFile(join(GEN, 'weapons', `${f}.json`), 'utf8')).weapons;
  lines.push(`## ${f === 'primary' ? '主武器' : '副武器'}（${weapons.length} 把）`);
  lines.push('');

  // 按 zkClass 分组
  const groups = new Map();
  for (const w of weapons) {
    const slot = slots[w.id];
    const zk = slot?.slots?.basis?.zkClass ?? '(无)';
    const broad = slot?.slots?.broad ?? '(无)';
    if (!groups.has(zk)) groups.set(zk, []);
    groups.get(zk).push({ w, broad, kinds: slot?.modKinds ?? [], specific: slot?.slots?.specific ?? [] });
  }

  const sorted = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  for (const [zk, list] of sorted) {
    const label = CATEGORY_LABEL[zk] ?? zk;
    lines.push(`### ${label}（zkClass = \`${zk}\`）— ${list.length} 把`);
    lines.push('');
    lines.push('| 武器 | broad | modKinds | specific |');
    lines.push('|---|---|---|---|');
    for (const it of list.slice(0, 40)) {
      const name = it.w.nameZh || it.w.name;
      lines.push(`| ${name} | ${it.broad} | ${it.kinds.join('/')} | ${it.specific.join('/') || '—'} |`);
    }
    if (list.length > 40) lines.push(`| …共 ${list.length} 把 | | | |`);
    lines.push('');
  }
}

const out = join(ROOT, 'docs/武器分类清单.md');
await writeFile(out, lines.join('\n'), 'utf8');
console.log(`已生成 ${out}`);

// 顺带打印统计
const all = [];
for (const f of files) {
  const weapons = JSON.parse(await readFile(join(GEN, 'weapons', `${f}.json`), 'utf8')).weapons;
  for (const w of weapons) all.push({ w, f, slot: slots[w.id] });
}
const noZk = all.filter((x) => !x.slot?.slots?.basis?.zkClass);
console.log(`总计 ${all.length} 把，其中 zkClass 为空 ${noZk.length} 把`);
if (noZk.length) {
  console.log('前 10 把无 zkClass 的武器：');
  for (const x of noZk.slice(0, 10)) console.log(`  ${x.w.id} | ${x.w.nameZh || x.w.name}`);
}
