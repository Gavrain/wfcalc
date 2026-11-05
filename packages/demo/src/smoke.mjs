/**
 * 冒烟：用真实数据跑一遍赤毒·卡拉克的结算，确认浏览器模式下"能跑出数"而不只是"能 import"。
 */
import { readFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = normalize(join(fileURLToPath(new URL('.', import.meta.url)), '../../..'));

export async function KuvaKarakSmoke(core, adapter) {
  const weapons = JSON.parse(await readFile(join(ROOT, 'packages/data/src/generated/weapons/primary.json'), 'utf8'));
  const modsJson = JSON.parse(await readFile(join(ROOT, 'packages/data/src/generated/mods/mods.json'), 'utf8'));

  const weapon = weapons.weapons.find((w) => w.id === 'KuvaKarak');
  const mode = weapon.modes.find((m) => m.id === 'primary');
  const mods = modsJson.mods;

  const build = ['serration', 'split_chamber', 'point_strike', 'vital_sense'];
  const contribs = [];
  for (const [i, id] of build.entries()) {
    const mod = mods.find((m) => m.id === id);
    contribs.push(...adapter.modToContributions(mod, mod.maxRank, i));
  }

  const res = core.compute(weapon, mode, contribs, {
    kuva: { type: 'heat', ratio: 0.5 },
    faction: 'grineer',
    headshot: { enabled: false, multiplier: 3 },
  });

  return res.output.perShot;
}
