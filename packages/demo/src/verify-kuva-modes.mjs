/**
 * 验证玄骸判定与多模式：直接查数据，确认哪些武器会隐藏玄骸加成、哪些会显示切换栏。
 */
import { readFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripTemp } from './strip-to-temp.mjs';

const ROOT = normalize(join(fileURLToPath(new URL('.', import.meta.url)), '../../..'));
const { transpile } = await import(new URL('./transpile.mjs', import.meta.url).href);
const core = await stripTemp(ROOT, 'packages/core/src/index.ts', transpile);
const { isKuvaFamily } = core;

const weapons = JSON.parse(await readFile(join(ROOT, 'packages/data/src/generated/weapons/primary.json'), 'utf8')).weapons;

let kuva = 0;
let multi = 0;
const kuvaList = [];
const multiList = [];
for (const w of weapons) {
  if (isKuvaFamily(w.id, w.variantType, w.name)) { kuva++; kuvaList.push(w.id); }
  if (w.modes.length > 1) { multi++; if (multiList.length < 5) multiList.push(`${w.id}(${w.modes.length})`); }
}

console.log(`武器总数 ${weapons.length}`);
console.log(`玄骸系（显示玄骸加成）: ${kuva}`);
console.log(`  例: ${kuvaList.slice(0, 8).join(', ')}`);
console.log(`多模式（显示切换栏）: ${multi}`);
console.log(`  例: ${multiList.join(', ')}`);

const checks = [];
checks.push(['卡拉克判为玄骸系', isKuvaFamily('KuvaKarak', undefined, 'Kuva Karak') === true]);
checks.push(['Braton Prime 不判为玄骸系', isKuvaFamily('BratonPrime', undefined, 'Braton Prime') === false]);
checks.push(['Coda 系判为玄骸系', isKuvaFamily('1999InfShotgunWeapon', undefined, 'Coda Bassocyst') === true]);
checks.push(['Tenet 系（内部 id 不带 Tenet）判为玄骸系',
  isKuvaFamily('CrpBEFerrox', undefined, 'Tenet Ferrox') === true]);
checks.push(['Kuva 系（内部 id 不带 Kuva）判为玄骸系',
  isKuvaFamily('GrnBowWeapon', undefined, 'Kuva Bramma') === true]);
checks.push(['玄骸系数量应为 24（按名字判定）', kuva === 24]);
checks.push(['存在非玄骸武器（应隐藏玄骸加成）', kuva < weapons.length]);
checks.push(['存在多模式武器（应显示切换栏）', multi > 0]);

let ok = true;
for (const [n, p] of checks) { if (!p) ok = false; console.log(`${p ? '✔' : '✖'} ${n}`); }
process.exit(ok ? 0 : 1);
