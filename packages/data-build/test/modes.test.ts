import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { allSegments } from '../../core/src/weapon.ts';
import {
  cleanWeapons,
  isPlaceholder,
  isIncarnonBehaviour,
  isUniformPhysicalPlaceholder,
  sameProjectile,
} from '../src/clean.ts';
import type { ExportWeapons, ExportBehaviour } from '../src/types.ts';

const auto = '/Lotus/Language/Menu/Loadout_TriggerAuto';
const charge = '/Lotus/Language/Menu/Loadout_TriggerCharge';

describe('占位段：等值物理模板', () => {
  it('识别 3.3333/3.3333/3.3334 + proc 0.1 模板', () => {
    assert.equal(
      isUniformPhysicalPlaceholder({ DT_IMPACT: 3.33333, DT_PUNCTURE: 3.33333, DT_SLASH: 3.33334, procChance: 0.1 }),
      true,
    );
  });

  it('识别 2.666664 模板', () => {
    assert.equal(
      isUniformPhysicalPlaceholder({ DT_IMPACT: 2.666664, DT_PUNCTURE: 2.666664, DT_SLASH: 2.666672, procChance: 0.1 }),
      true,
    );
  });

  it('不等值的真实物理分布不算占位', () => {
    assert.equal(
      isUniformPhysicalPlaceholder({ DT_IMPACT: 9, DT_PUNCTURE: 153, DT_SLASH: 18, procChance: 0.2 }),
      false,
    );
  });

  it('等值但数值很大时不算占位（真实高伤三等分）', () => {
    assert.equal(
      isUniformPhysicalPlaceholder({ DT_IMPACT: 112.5, DT_PUNCTURE: 150, DT_SLASH: 112.5, procChance: 0.5 }),
      false,
    );
  });

  it('含其它伤害类型时不算占位', () => {
    assert.equal(
      isUniformPhysicalPlaceholder({ DT_IMPACT: 5, DT_PUNCTURE: 5, DT_SLASH: 5, DT_FIRE: 10 }),
      false,
    );
  });
});

describe('占位 behaviour：绝不整体丢弃带投射的条目', () => {
  it('带 projectile 的 behaviour 即使 impact 是模板也不整体丢弃', () => {
    const b: ExportBehaviour = {
      stateName: charge,
      fireIterations: 1,
      impact: { DT_IMPACT: 2.666664, DT_PUNCTURE: 2.666664, DT_SLASH: 2.666672, procChance: 0.1 },
      projectile: { attack: { DT_IMPACT: 9, DT_PUNCTURE: 153, DT_SLASH: 18, procChance: 0.2 } },
    };
    assert.equal(isPlaceholder(b), false);
  });

  it('带 chargedProjectile 的 behaviour 也不整体丢弃', () => {
    const b: ExportBehaviour = {
      stateName: charge,
      fireIterations: 1,
      chargedProjectile: { attack: { DT_IMPACT: 9, DT_PUNCTURE: 288, DT_SLASH: 63 } },
    };
    assert.equal(isPlaceholder(b), false);
  });

  it('无 stateName 的裸冲击条目仍被丢弃', () => {
    assert.equal(isPlaceholder({ fireIterations: 1, impact: { DT_IMPACT: 40, procChance: 0.1 } }), true);
  });

  it('有 stateName、无投射、仅裸冲击的条目被丢弃', () => {
    assert.equal(isPlaceholder({ stateName: auto, fireIterations: 1, impact: { DT_IMPACT: 40 } }), true);
  });
});

describe('chargedProjectile 处理', () => {
  it('相同视为同一投射（只能蓄满发射）', () => {
    const p = { attack: { DT_BLAST: 100 }, explosiveAttack: { DT_BLAST: 600 } };
    assert.equal(sameProjectile(p, { attack: { DT_BLAST: 100 }, explosiveAttack: { DT_BLAST: 600 } }), true);
  });

  it('不同视为可区分（需拆成两个模式）', () => {
    assert.equal(
      sameProjectile({ attack: { DT_SLASH: 134.4 } }, { attack: { DT_SLASH: 302.4 } }),
      false,
    );
  });

  it('食人女魔类：projectile 与 chargedProjectile 相同 → 只产生一个模式', () => {
    const p = {
      attack: { DT_EXPLOSION: 100, procChance: 0.35 },
      explosiveAttack: { DT_EXPLOSION: 600, procChance: 0.35 },
    };
    const result = cleanWeapons({
      '/Lotus/Weapons/Test/Ogris': {
        productCategory: 'LongGuns',
        criticalChance: 0.05,
        criticalMultiplier: 2,
        procChance: 0.35,
        fireRate: 1.5,
        multishot: 1,
        behaviours: [{ stateName: charge, fireIterations: 1, projectile: p, chargedProjectile: p }],
      },
    });
    const modes = result.weapons[0]!.modes;
    assert.equal(modes.length, 1);
    assert.equal(modes[0]!.role, 'normal');
  });

  it('弓类：projectile 与 chargedProjectile 不同 → 产生普通 + 蓄力两个模式', () => {
    const result = cleanWeapons({
      '/Lotus/Weapons/Test/Daikyu': {
        productCategory: 'LongGuns',
        criticalChance: 0.4,
        criticalMultiplier: 2.4,
        procChance: 0.5,
        fireRate: 1,
        multishot: 1,
        behaviours: [
          {
            stateName: charge,
            fireIterations: 1,
            projectile: { attack: { DT_IMPACT: 112.5, DT_PUNCTURE: 150, DT_SLASH: 112.5 } },
            chargedProjectile: { attack: { DT_IMPACT: 225, DT_PUNCTURE: 300, DT_SLASH: 225 } },
          },
        ],
      },
    });
    const modes = result.weapons[0]!.modes;
    assert.equal(modes.length, 2);
    assert.deepEqual(modes.map((m) => m.role), ['normal', 'charged']);
  });
});

describe('灵化模式识别', () => {
  it('仅 chargedProjectile 且武器已有普通射击 → 灵化', () => {
    const b: ExportBehaviour = {
      stateName: charge,
      fireIterations: 1,
      chargedProjectile: { attack: { DT_IMPACT: 100, DT_FIRE: 420 } },
    };
    assert.equal(isIncarnonBehaviour(b, true), true);
  });

  it('武器没有任何普通射击时，不判为灵化（只能蓄满发射）', () => {
    const b: ExportBehaviour = {
      stateName: charge,
      fireIterations: 1,
      chargedProjectile: { attack: { DT_IMPACT: 210, DT_PUNCTURE: 280, DT_SLASH: 210 } },
    };
    assert.equal(isIncarnonBehaviour(b, false), false);
  });

  it('带 projectile 的不是灵化', () => {
    const b: ExportBehaviour = {
      stateName: charge,
      fireIterations: 1,
      projectile: { attack: { DT_SLASH: 100 } },
      chargedProjectile: { attack: { DT_SLASH: 200 } },
    };
    assert.equal(isIncarnonBehaviour(b, true), false);
  });

  it('帕里斯 Prime 三面板：普通 / 蓄力 / 灵化', () => {
    const result = cleanWeapons({
      '/Lotus/Weapons/Tenno/Bows/PrimeHuntingBow': {
        productCategory: 'LongGuns',
        criticalChance: 0.45,
        criticalMultiplier: 2,
        procChance: 0.2,
        fireRate: 1,
        multishot: 1,
        behaviours: [
          {
            stateName: charge,
            fireIterations: 1,
            impact: { DT_IMPACT: 2.666664, DT_PUNCTURE: 2.666664, DT_SLASH: 2.666672, procChance: 0.1 },
            projectile: { attack: { DT_IMPACT: 9, DT_PUNCTURE: 153, DT_SLASH: 18, procChance: 0.2 } },
            chargedProjectile: { attack: { DT_IMPACT: 9, DT_PUNCTURE: 288, DT_SLASH: 63, procChance: 0.2 } },
          },
          {
            stateName: charge,
            fireIterations: 1,
            impact: { DT_IMPACT: 3.33333, DT_PUNCTURE: 3.33333, DT_SLASH: 3.33334, procChance: 0.1 },
            chargedProjectile: { attack: { DT_IMPACT: 100, DT_FIRE: 420, procChance: 0.2 } },
          },
        ],
      },
    });

    const modes = result.weapons[0]!.modes;
    assert.deepEqual(modes.map((m) => m.id), ['primary', 'charged', 'incarnon']);
    assert.deepEqual(modes.map((m) => m.role), ['normal', 'charged', 'incarnon']);

    // 灵化模式伤害分布正确
    assert.deepEqual(allSegments(modes[2]!)[0]!.damage, { impact: 100, heat: 420 });

    // 占位 impact 段被过滤，未混入普通模式
    assert.equal(allSegments(modes[0]!).length, 1);
    assert.deepEqual(allSegments(modes[0]!)[0]!.damage, { impact: 9, puncture: 153, slash: 18 });
  });
});
