// 按内部 id 检查几把代表武器的 Mod 槽位判定。
import { readFileSync } from 'node:fs';

const slots = JSON.parse(readFileSync('packages/data/src/generated/mods/weapon-slots.json', 'utf8'));

const picks = ['PrismaSkana', 'PrimeStrunWeapon', 'MK1Strun', 'KuvaOgris', 'HuntingBow', 'VulkarWraith', 'KogakePrime', 'TnTeslaRifle'];
for (const id of picks) {
  const w = slots.weapons[id];
  if (!w) continue;
  console.log(`${w.name.padEnd(22)} ${String(w.nameZh ?? '').padEnd(12)} → kinds=${JSON.stringify(w.modKinds).padEnd(34)} src=${w.slots.source} specific=${JSON.stringify(w.slots.specific)}`);
}

// 判定来源分布
const dist = {};
for (const w of Object.values(slots.weapons)) {
  const k = `${w.slots.source}${w.slots.unresolved ? '(待确认)' : ''}`;
  dist[k] = (dist[k] ?? 0) + 1;
}
console.log('\n判定来源分布:', JSON.stringify(dist, null, 1));

// 近战细类覆盖
const melee = Object.values(slots.weapons).filter((w) => w.slots.broad === 'melee');
const noSpecific = melee.filter((w) => w.slots.specific.length === 0);
console.log(`\n近战 ${melee.length} 把，其中无细类 ${noSpecific.length} 把`);
console.log('无细类样例:', noSpecific.slice(0, 10).map((w) => w.name).join(', '));
