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
// 步枪池张数随 Mod 数据变化，改数据时同步更新；关键是下面的**过滤行为**断言。
// 2026-11-08：421→478 张（新增 37 张曲翼枪 Mod，slotKind=archgun，不进步枪池），
// 实测步枪 + 主武器池 = 121 张，与改数据前一致。
checks.push(['步枪池共 121 张', riflePool.length === 121, riflePool.length]);
checks.push(['卡拉克过滤后减少', karakMods.length < riflePool.length]);
checks.push(['通用卡「膛线」保留', karakMods.some((m) => m.id === 'serration')]);
checks.push(['通用卡「镀层 步枪才能」保留', karakMods.some((m) => m.id === 'galvanized_aptitude')]);
checks.push(['专属卡「brain_storm」(Grakata) 被排除', !karakMods.some((m) => m.id === 'brain_storm')]);
checks.push(['专属卡「hata_satya」(Soma Prime) 被排除', !karakMods.some((m) => m.id === 'hata_satya')]);
checks.push(['专属卡「nightwatch_napalm」(Ogris) 被排除', !karakMods.some((m) => m.id === 'nightwatch_napalm')]);
// D-024 剔除清单：aerial_ace 不应出现在任何池里。
// 2026-11-08：幽灵膛线 **恢复收录**——`EXCLUDED_MODS` 里从来没有它（只剔了 aerial_ace），
// 而且需求方 D-140 明确要它按「满级 330、每级 30」收录，所以旧断言与现状相矛盾。
checks.push(['幽灵膛线 spectral_serration 已收录且满级 330', (() => {
  const m = mods.find((x) => x.id === 'spectral_serration');
  return Boolean(m) && m.stats.some((s) => s.key === 'dmg' && s.levelValues.at(-1) === 330);
})()]);
checks.push(['空中制霸 aerial_ace 不收录', !mods.some((m) => m.id === 'aerial_ace')]);

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
