/**
 * 赋能多词条解析（D-084 的连带修正，需求方 2026-11-06）：
 * 「确认其他赋能，例如霜冻是否正确生效所有词条」。
 *
 * 官方导出的数值槽名只编号、不带语义（`BONUS1` / `BONUS2`），必须按 Mod 描述对齐。
 * 旧实现按 `bucket` 推断，导致霜冻的「+3% 暴伤」被错算成多重。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { arcaneToContributions, type ArcaneRecord } from '../src/adapter.ts';

const ROOT = normalize(join(fileURLToPath(new URL('.', import.meta.url)), '../../..'));
const arcanes = JSON.parse(await readFile(join(ROOT, 'packages/data/src/generated/mods/arcanes.json'), 'utf8'))
  .arcanes as ArcaneRecord[];

function arcane(id: string): ArcaneRecord {
  const a = arcanes.find((x) => x.id === id);
  assert.ok(a, `arcanes.json 里没有 ${id}`);
  return a;
}

/** 贡献 → { 属性: 数值 } */
function byStat(id: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of arcaneToContributions(arcane(id))) out[c.stat] = (out[c.stat] ?? 0) + c.amount;
  return out;
}

describe('赋能多词条：两条词条都要生效', () => {
  it('主要·霜冻：暴伤 +120% / 多重 +90%（不是两条都算多重）', () => {
    const c = byStat('PrimaryCritDmgAndMultishotOnColdProc');
    assert.equal(c.critMultiplier, 120); // 3% × 40 层
    assert.equal(c.multishot, 90); // 2.25% × 40 层
  });

  it('主要·毒侵：暴伤 +144% / 多重 +72%', () => {
    const c = byStat('PrimaryHeadshotCritMultOnHeadshot');
    assert.equal(c.critMultiplier, 144); // 3.6 × 40
    assert.equal(c.multishot, 72); // 1.8 × 40
  });

  it('联结·电压：装填速度 +60% / 多重 +120%', () => {
    const c = byStat('SecondaryReloadSpeedAndMultishotOnElectricProc');
    assert.equal(c.reloadSpeed, 60); // 1.5 × 40
    assert.equal(c.multishot, 120); // 3 × 40
  });

  it('霰弹·仇杀：多重 +180% / 装填速度 +75%（不叠层）', () => {
    const c = byStat('ShotgunMultishotAndReloadSpeedOnCloseKill');
    assert.equal(c.multishot, 180);
    assert.equal(c.reloadSpeed, 75);
  });

  it('近战·同化：基伤 +150%，护盾那条不影响伤害', () => {
    const c = byStat('HeavyAttackDamageAndShieldOnShieldBreak');
    assert.equal(c.baseDamage, 150);
    assert.equal(Object.keys(c).length, 1);
  });

  it('主要·准星：状态触发率 +300% / 弹药效率 +60%', () => {
    const c = byStat('StatusAndAmmoEfficiencyOnWeakpointHit');
    assert.equal(c.statusChance, 300); // 30 × 10
    assert.equal(c.ammoEfficiency, 60); // 6 × 10
  });

  it('主要·无情：只有基伤 +360%（装填速度那条不重复计）', () => {
    const c = byStat('PrimaryDamageOnKill');
    assert.equal(c.baseDamage, 360);
    assert.equal(Object.keys(c).length, 1);
  });
});

describe('赋能排除清单（不是武器伤害词条）', () => {
  const ignored = [
    'ExtraProcOnProc', // 二次触发概率
    'PrimaryEnergyRegenOnImpactProc', // 能量回复
    'SecondaryOnRollCritChanceOnHeadshot', // 仅弱点命中的暴率
    'SecondaryOnStatusProcBonusDamage', // 固定附加伤害
    'StatusTriggerRadialDamage', // 神威·气力：需求方 2026-11-06「设置成无效果」
    'SecondaryColdOnPuncture', // D-138：NUM_PROCS 是"施加 3 层冰冻异常"的层数，不是触发几率
    'BurningCystOnKill',
    'IceMistOnKill',
    'LightningStrikeOnKill',
    'ToxicBloodOnKill',
  ];

  for (const id of ignored) {
    it(`${id} 不产出任何贡献`, () => {
      assert.deepEqual(byStat(id), {});
    });
  }

  it('瀑流·耀炎（bucket 标错）按基伤计，不是状态触发率；满层 480%（12% × 40）', () => {
    const c = byStat('SecondaryDamageOnHeatProc');
    assert.equal(c.baseDamage, 480);
    assert.equal(c.statusChance, undefined);
  });
});

describe('类镀层：次要·冷颤只认冰冻层数（D-086）', () => {
  it('产出 coFreeze 贡献，不是 statusChance', () => {
    const c = byStat('SecondaryExtraDamagePerFreezeStack');
    assert.equal(c.coFreeze, 45);
    assert.equal(c.statusChance, undefined);
  });
});

describe('D-138：次要赋能加成逐条核对', () => {
  it('次要·爆发：暴率 +20 和暴伤 +20 两条都有（以前只有暴伤）', () => {
    const c = byStat('MultishotForCombo');
    assert.equal(c.critChance, 20);
    assert.equal(c.critMultiplier, 20);
    assert.equal(Object.keys(c).length, 2);
  });

  it('次要·死首：基伤 +360% 且弱点伤害 +30%（与主要·死首同口径，30% 不随层数叠）', () => {
    const s = byStat('SecondaryDamageOnNoMelee');
    assert.equal(s.baseDamage, 360); // 120 × 3 层
    assert.equal(s.weakpointDamage, 30);
    const p = byStat('PrimaryDamageOnNoMelee');
    assert.deepEqual(s, p);
  });

  it('瀑流·耀炎：满层 480%（12% × 40 层）记在基伤', () => {
    const c = byStat('SecondaryDamageOnHeatProc');
    assert.equal(c.baseDamage, 480);
    assert.equal(c.statusChance, undefined);
  });
});

describe('D-138：赋能安装位大类', () => {
  function cat(id: string): string {
    return arcane(id).category;
  }

  it('弓箭·利矢归 bow，霰弹·仇杀归 shotgun（以前都落在 secondary）', () => {
    assert.equal(cat('LongbowDamageOnHeadshot'), 'bow');
    assert.equal(cat('ShotgunMultishotAndReloadSpeedOnCloseKill'), 'shotgun');
  });

  it('分形·重置归 primary（它本来就是主要武器赋能）', () => {
    assert.equal(cat('PrimaryOnAbilityReloadSpeed'), 'primary');
  });

  it('次要·/ 瀑流· / 联结· 仍是 secondary', () => {
    assert.equal(cat('SecondaryDamageOnKill'), 'secondary');
    assert.equal(cat('SecondaryDamageOnHeatProc'), 'secondary');
    assert.equal(cat('SecondaryReloadSpeedAndMultishotOnElectricProc'), 'secondary');
  });
});
