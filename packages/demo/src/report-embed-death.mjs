/**
 * 核对 `embedDeathAttack` 是否该被算作独立伤害段（D-078 的证据脚本）。
 *   node packages/demo/src/report-embed-death.mjs [武器名过滤]
 *
 * 对每把同时带 `embedDeathAttack` 且能在 WFCD 对上的武器，比较：
 *   WFCD 总面板  vs  官方各段合计（不含 embedDeath）  vs  含 embedDeath
 * 哪个更接近 WFCD，就说明哪一侧的口径对。
 */
import { readFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = normalize(join(fileURLToPath(new URL('.', import.meta.url)), '../../..'));
const read = async (p) => JSON.parse(await readFile(join(ROOT, p), 'utf8'));

const filter = process.argv[2] ?? '';

const raw = await read('.cache/export/weapons.json');
const langEn = await read('.cache/export/langEn.json');

const wfcdAll = [];
for (const f of ['Primary.json', 'Secondary.json', 'Melee.json', 'Arch-Gun.json', 'Arch-Melee.json']) {
  try {
    wfcdAll.push(...(await read(`.cache/wfcd-items-pkg/package/data/json/${f}`)));
  } catch { /* 缺文件跳过 */ }
}
const byName = new Map(wfcdAll.map((x) => [x.name, x]));

const sum = (a) => Object.entries(a || {}).filter(([k]) => k.startsWith('DT_')).reduce((x, [, v]) => x + v, 0);

const rows = [];
for (const key of Object.keys(raw)) {
  const w = raw[key];
  const nameEn = langEn[w.name];
  if (!nameEn) continue;
  if (filter && !nameEn.toLowerCase().includes(filter.toLowerCase())) continue;
  const wc = byName.get(nameEn);
  for (const b of w.behaviours || []) {
    const p = b.projectile;
    if (!p || !p.embedDeathAttack) continue;
    const impact = sum(b.impact);
    const attack = sum(p.attack);
    const explosive = sum(p.explosiveAttack);
    const embedDeath = sum(p.embedDeathAttack);
    const noEmbed = impact + attack + explosive;
    const withEmbed = noEmbed + embedDeath;
    rows.push({
      name: nameEn,
      wfcdTotal: wc?.damage?.total ?? null,
      wfcdAttacks: (wc?.attacks ?? []).map((a) => a.name),
      impact, attack, explosive, embedDeath, noEmbed, withEmbed,
    });
  }
}

const pad = (s, n) => String(s).padEnd(n);
const num = (n, w = 6) => (n == null ? '-'.padStart(w) : n.toFixed(0).padStart(w));

console.log(pad('武器', 24), pad('WFCD总', 7), pad('不含embed', 9), pad('含embed', 8), ' | 官方分段（冲/命/爆/嵌）');
console.log('─'.repeat(96));
let noBetter = 0, withBetter = 0, none = 0;
for (const r of rows) {
  let tag = '';
  if (r.wfcdTotal == null) { none++; tag = '(WFCD无)'; }
  else if (Math.abs(r.noEmbed - r.wfcdTotal) < Math.abs(r.withEmbed - r.wfcdTotal)) { noBetter++; tag = '← 不含更准'; }
  else { withBetter++; tag = '← 含更准'; }
  console.log(
    pad(r.name, 24), num(r.wfcdTotal, 7), num(r.noEmbed, 9), num(r.withEmbed, 8),
    ` | ${r.impact.toFixed(0)}/${r.attack.toFixed(0)}/${r.explosive.toFixed(0)}/${r.embedDeath.toFixed(0)}  ${tag}`,
  );
}

console.log('─'.repeat(96));
console.log(`合计 ${rows.length} 条：不含 embedDeath 更接近 WFCD ${noBetter} 条，含 embedDeath 更接近 ${withBetter} 条，WFCD 无数据 ${none} 条`);
