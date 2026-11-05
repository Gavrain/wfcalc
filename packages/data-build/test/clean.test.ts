import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cleanWeapons, isPlaceholder, toTriggerKind, EXCLUDED_CATEGORIES } from '../src/clean.ts';
import type { ExportWeapons } from '../src/types.ts';

const weapon = (overrides: Record<string, unknown> = {}): ExportWeapons[string] => ({
  name: '/Lotus/Language/Items/TestName',
  productCategory: 'LongGuns',
  criticalChance: 0.25,
  criticalMultiplier: 2.5,
  procChance: 0.19,
  fireRate: 13.000001,
  multishot: 1,
  behaviours: [
    {
      // 真实步枪结构：投射攻击 + 真实物理分布（非裸冲击）
      stateName: '/Lotus/Language/Menu/Loadout_TriggerAuto',
      fireIterations: 1,
      projectile: { attack: { DT_IMPACT: 5, DT_PUNCTURE: 20, DT_SLASH: 8, procChance: 0.19 } },
    },
  ],
  ...overrides,
});

describe('清洗：占位条目识别', () => {
  it('无 stateName 且只有单一冲击的条目视为占位', () => {
    assert.equal(isPlaceholder({ fireIterations: 1, impact: { DT_IMPACT: 40, procChance: 0.1 } }), true);
  });

  it('有 stateName 但只有裸冲击、无投射的条目同样视为占位（实测模板）', () => {
    assert.equal(
      isPlaceholder({
        stateName: '/Lotus/Language/Menu/Loadout_TriggerAuto',
        fireIterations: 1,
        impact: { DT_IMPACT: 40 },
      }),
      true,
    );
  });

  it('带 projectile 的不算占位', () => {
    assert.equal(
      isPlaceholder({ fireIterations: 1, impact: { DT_IMPACT: 40 }, projectile: { attack: { DT_IMPACT: 5 } } }),
      false,
    );
  });

  it('带 stateName 且有多种伤害类型的不算占位', () => {
    assert.equal(
      isPlaceholder({ stateName: '/Lotus/Language/Menu/Loadout_TriggerAuto', impact: { DT_IMPACT: 10, DT_SLASH: 5 } }),
      false,
    );
  });
});

describe('清洗：触发方式', () => {
  it('识别常见 stateName', () => {
    assert.equal(toTriggerKind('/Lotus/Language/Menu/Loadout_TriggerAuto'), 'auto');
    assert.equal(toTriggerKind('/Lotus/Language/Menu/Loadout_TriggerSemiAuto'), 'semi');
    assert.equal(toTriggerKind('/Lotus/Language/Menu/Loadout_TriggerBurst'), 'burst');
    assert.equal(toTriggerKind(undefined), 'unknown');
  });
});

describe('清洗：Tau 伤害类型', () => {
  it('DT_SENTIENT 映射为 tau 而不是被忽略（以真实 Haalvu 结构为准）', () => {
    const result = cleanWeapons({
      '/Lotus/Weapons/Sentients/SentOctaMiniGun/SentOctaMiniGun': weapon({
        totalDamage: 33,
        behaviours: [
          {
            stateName: '/Lotus/Language/Menu/Loadout_TriggerAuto',
            fireIterations: 1,
            impact: { DT_SENTIENT: 33, procChance: 0.19 },
          },
          {
            stateName: '/Lotus/Language/Menu/Loadout_TriggerBurst',
            fireIterations: 1,
            burst: { count: 2, delay: 0.05 },
            impact: { DT_SENTIENT: 34, procChance: 0.26 },
          },
        ],
      }),
    });
    const w = result.weapons[0]!;
    assert.equal(w.modes.length, 2);
    assert.equal(w.modes[0]!.segments[0]!.damage.tau, 33);
    assert.equal(w.modes[1]!.segments[0]!.damage.tau, 34);
    assert.equal(w.modes[1]!.burst!.count, 2);
    assert.equal(result.stats.weaponsWithUnknownDamageType, 0);
  });
});

describe('清洗：分类过滤', () => {
  it('指挥官武器与 Drifter 近战被排除', () => {
    const result = cleanWeapons({
      '/Lotus/Weapons/Operator/Pistols/DrifterPistol/DrifterPistolPlayerWeapon': weapon({
        productCategory: 'OperatorAmps',
      }),
      '/Lotus/Weapons/Duviri/DaxDuviriKatanaPlayerWeapon': weapon({ productCategory: 'DrifterMelee' }),
      '/Lotus/Weapons/Tenno/Rifle/Rifle': weapon(),
    });
    assert.equal(result.stats.excludedByCategory, 2);
    assert.equal(result.stats.keptWeapons, 1);
    assert.deepEqual(result.weapons.map((w) => w.id), ['Rifle']);
  });

  it('战甲技能武器与同伴武器被保留', () => {
    const result = cleanWeapons({
      '/Lotus/Weapons/Tenno/Exalted/ExaltedBow': weapon({ productCategory: 'SpecialItems' }),
      '/Lotus/Weapons/Sentinel/LaserRifle': weapon({ productCategory: 'SentinelWeapons' }),
    });
    assert.equal(result.stats.keptWeapons, 2);
  });

  it('排除列表不包含需要保留的分类', () => {
    for (const kept of ['LongGuns', 'Pistols', 'Melee', 'SpecialItems', 'SentinelWeapons', 'SpaceGuns', 'SpaceMelee']) {
      assert.equal(EXCLUDED_CATEGORIES.includes(kept), false, `${kept} 不应被排除`);
    }
  });
});

describe('清洗：多模式与 AoE', () => {
  it('区分 attack 与 explosiveAttack，并标记 AoE', () => {
    const result = cleanWeapons({
      '/Lotus/Weapons/Test/Ogris': weapon({
        behaviours: [
          {
            stateName: '/Lotus/Language/Menu/Loadout_TriggerSemiAuto',
            fireIterations: 1,
            projectile: {
              attack: { DT_IMPACT: 100, procChance: 0.3 },
              explosiveAttack: { DT_EXPLOSION: 400, procChance: 0.3 },
            },
          },
        ],
      }),
    });
    const segs = result.weapons[0]!.modes[0]!.segments;
    assert.equal(segs.length, 2);
    assert.equal(segs.find((s) => s.kind === 'attack')!.isAoe, false);
    assert.equal(segs.find((s) => s.kind === 'explosiveAttack')!.isAoe, true);
    assert.equal(segs.find((s) => s.kind === 'explosiveAttack')!.damage.blast, 400);
    assert.equal(result.stats.weaponsWithAoe, 1);
  });

  it('浮点误差被规范化', () => {
    const result = cleanWeapons({ '/Lotus/Weapons/Test/F': weapon() });
    assert.equal(result.weapons[0]!.fireRate, 13);
  });
});
