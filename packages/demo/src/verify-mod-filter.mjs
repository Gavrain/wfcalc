/**
 * D-029：武器专属 Mod 过滤。
 *   node packages/demo/src/verify-mod-filter.mjs
 */
import { readFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripTemp } from './strip-to-temp.mjs';

const ROOT = normalize(join(fileURLToPath(new URL('.', import.meta.url)), '../../..'));
const { transpile } = await import(new URL('./transpile.mjs', import.meta.url).href);
const adapter = await stripTemp(ROOT, 'packages/data/src/adapter.ts', transpile);

const weapons = JSON.parse(await readFile(join(ROOT, 'packages/data/src/generated/weapons/primary.json'), 'utf8')).weapons;
const mods = JSON.parse(await readFile(join(ROOT, 'packages/data/src/generated/mods/mods.json'), 'utf8')).mods;

const karak = weapons.find((w) => w.id === 'KuvaKarak');
const grakata = weapons.find((w) => w.id === 'Grakata');

const riflePool = mods.filter((m) => ['rifle', 'primary'].includes(m.slotKind));
const karakMods = riflePool.filter((m) => adapter.isModCompatibleWithWeapon(m, karak));

const checks = [];
checks.push(['步枪池共 122 张', riflePool.length === 122]);
checks.push(['卡拉克过滤后减少', karakMods.length < riflePool.length]);
checks.push(['通用卡「膛线」保留', karakMods.some((m) => m.id === 'serration')]);
checks.push(['通用卡「镀层 步枪才能」保留', karakMods.some((m) => m.id === 'galvanized_aptitude')]);
checks.push(['专属卡「brain_storm」(Grakata) 被排除', !karakMods.some((m) => m.id === 'brain_storm')]);
checks.push(['专属卡「hata_satya」(Soma Prime) 被排除', !karakMods.some((m) => m.id === 'hata_satya')]);
checks.push(['专属卡「nightwatch_napalm」(Ogris) 被排除', !karakMods.some((m) => m.id === 'nightwatch_napalm')]);

if (grakata) {
  const grakataMods = riflePool.filter((m) => adapter.isModCompatibleWithWeapon(m, grakata));
  checks.push(['Grakata 能装「brain_storm」', grakataMods.some((m) => m.id === 'brain_storm')]);
  checks.push(['Grakata 装不了 Soma Prime 的卡', !grakataMods.some((m) => m.id === 'hata_satya')]);
}

let ok = true;
for (const [name, pass] of checks) {
  if (!pass) ok = false;
  console.log(`${pass ? '✔' : '✖'} ${name}`);
}
console.log(`\n卡拉克可用：${karakMods.length} / ${riflePool.length}（排除 ${riflePool.length - karakMods.length} 张专属卡）`);
process.exit(ok ? 0 : 1);
