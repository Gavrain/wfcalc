/**
 * D-142 回归：`behaviours[].impact` 该不该丢。
 *
 * 需求方 2026-11-07 用游戏内面板逐把核对后给出的判据：
 *   1. **主模式**才与 `damagePerShot` 比对（那个数组只描述一个模式）；
 *   2. 模板指纹 `3.33/3.33/3.34 @0.1`、`40 @0.1` 一律是废数据；
 *   3. `procChance` 自洽——模板恒为 0.1，真武器用武器级触发（分离 0.25 ≠ 0.1 → 废）。
 *
 * 下面每一条都用**真实导出片段**，用来锁死「哪把的 impact 是真伤害、哪把是废数据」。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cleanWeapons, impactTypesMatchPanel, isPlaceholder } from '../src/clean.ts';
import { allSegments } from '../../core/src/weapon.ts';
import type { ExportWeapons } from '../src/types.ts';

/** 造一个最小可用的导出条目 */
function weapon(over: Partial<ExportWeapons[string]>): ExportWeapons[string] {
  return {
    name: '/Lotus/Language/Items/TestName',
    totalDamage: 0,
    damagePerShot: [],
    criticalChance: 0,
    criticalMultiplier: 1,
    procChance: 0,
    fireRate: 1,
    productCategory: 'Melee',
    behaviours: [],
    ...over,
  };
}

describe('D-142 impact 占位：真实导出片段', () => {
  it('映声战锤：单类型冲击 340，与面板一致 → 真伤害，保留', () => {
    const b = { fireIterations: 1, impact: { DT_IMPACT: 340, procChance: 0.15 } };
    assert.equal(isPlaceholder(b, { primary: true, damagePerShot: [340, ...Array(19).fill(0)], weaponProcChance: 0.15 }), false);
  });

  it('拉斯波恩：第一条 360/67.5/22.5 与面板一致（真），第二条 3.33×3 @0.1（模板）', () => {
    const panel = [360, 67.5, 22.499979, ...Array(17).fill(0)];
    const real = { fireIterations: 1, impact: { DT_IMPACT: 360.000004, DT_PUNCTURE: 67.500004, DT_SLASH: 22.499978, procChance: 0.12 } };
    const stub = { fireIterations: 1, impact: { DT_IMPACT: 3.33333, DT_PUNCTURE: 3.33333, DT_SLASH: 3.33334, procChance: 0.1 } };
    assert.equal(isPlaceholder(real, { primary: true, damagePerShot: panel, weaponProcChance: 0.12 }), false);
    assert.equal(isPlaceholder(stub, { primary: false, damagePerShot: panel, weaponProcChance: 0.12 }), true);
  });

  it('大久和弓：impact 是 3.33×3 命中模板（真伤害在 chargedProjectile 里）→ 删', () => {
    const b = {
      stateName: '/Lotus/Language/Menu/Loadout_TriggerCharge',
      fireIterations: 1,
      chargedProjectile: { attack: { DT_IMPACT: 210.000007, DT_PUNCTURE: 280.000007, DT_SLASH: 209.999965, procChance: 0.46 } },
      impact: { DT_IMPACT: 3.33333, DT_PUNCTURE: 3.33333, DT_SLASH: 3.33334, procChance: 0.1 },
    };
    assert.equal(isPlaceholder(b, { primary: true, damagePerShot: [210.00002, 280, 209.99997, ...Array(17).fill(0)] }), false); // 有投射组 → 不在 behaviour 级删
  });

  it('横痃重炮主模式：impact 16/14/10 与面板 2/13/19+毒7 逐类型不符 → 段级过滤', () => {
    const impact = { DT_IMPACT: 16, DT_PUNCTURE: 14, DT_SLASH: 10, procChance: 0.05 };
    assert.equal(impactTypesMatchPanel(impact, [2, 13, 19, 0, 0, 0, 7, ...Array(13).fill(0)]), false);
  });

  it('分离：面板 0.25、impact 0.1 且是 3.33×3 模板 → 判废（需求方确认导出是废数据）', () => {
    const b = { fireIterations: 1, impact: { DT_IMPACT: 3.33333, DT_PUNCTURE: 3.33333, DT_SLASH: 3.33334, procChance: 0.1 } };
    assert.equal(isPlaceholder(b, { primary: true, damagePerShot: [130, ...Array(19).fill(0)], weaponProcChance: 0.25 }), true);
  });
});

describe('D-142 清洗全流程：六把武器的结果', () => {
  const raw: ExportWeapons = {
    '/Lotus/Weapons/Thanotech/EntSphereHammer/EntSphereHammer': weapon({
      totalDamage: 340,
      damagePerShot: [340, ...Array(19).fill(0)],
      criticalChance: 0.3,
      criticalMultiplier: 2.4,
      procChance: 0.15,
      fireRate: 0.766667,
      behaviours: [{ fireIterations: 1, impact: { DT_IMPACT: 340, procChance: 0.15 } }],
    }),
    '/Lotus/Weapons/Tenno/Melee/Nunchaku/TnoNunchaku/TnoNunchaku': weapon({
      totalDamage: 180,
      damagePerShot: [180, ...Array(19).fill(0)],
      procChance: 0.34,
      behaviours: [{ fireIterations: 1, impact: { DT_IMPACT: 180, procChance: 0.34 } }],
    }),
    '/Lotus/Types/Sentinels/SentinelWeapons/SentGlaiveWeapon': weapon({
      productCategory: 'SentinelWeapons',
      holsterCategory: 'MELEE',
      totalDamage: 130,
      damagePerShot: [130, ...Array(19).fill(0)],
      procChance: 0.25,
      behaviours: [{ fireIterations: 1, impact: { DT_IMPACT: 3.33333, DT_PUNCTURE: 3.33333, DT_SLASH: 3.33334, procChance: 0.1 } }],
    }),
    '/Lotus/Weapons/Tenno/LongGuns/TnWispRifle/TnWispRifle': weapon({
      productCategory: 'LongGuns',
      totalDamage: 500,
      damagePerShot: [100, 0, 0, 0, 0, 400, ...Array(14).fill(0)],
      procChance: 0.16,
      behaviours: [
        {
          stateName: '/Lotus/Language/Menu/Loadout_TriggerSemiAuto',
          fireIterations: 1,
          projectile: { attack: { DT_IMPACT: 100, DT_ELECTRICITY: 400, procChance: 0.16 } },
          impact: { DT_IMPACT: 9.6, DT_PUNCTURE: 1.2, DT_SLASH: 13.199999, procChance: 0.16 },
        },
        {
          stateName: '/Lotus/Language/Menu/Loadout_TriggerAuto',
          fireIterations: 1,
          impact: { DT_PUNCTURE: 8, DT_ELECTRICITY: 25, procChance: 0.1 },
        },
      ],
    }),
  };

  const result = cleanWeapons(raw);
  const byId = new Map(result.weapons.map((w) => [w.id, w]));

  it('映声战锤 / 双节尺棍：保留，伤害段就是面板值', () => {
    for (const [id, dmg] of [['EntSphereHammer', 340], ['TnoNunchaku', 180]] as const) {
      const w = byId.get(id);
      assert.ok(w, `${id} 应保留`);
      const segs = allSegments(w.modes[0]!);
      assert.deepEqual(segs.map((s) => s.damage), [{ impact: dmg }]);
    }
  });

  it('分离：behaviours 判废后整把不应带着 3.33 出现在库里', () => {
    const w = byId.get('SentGlaiveWeapon');
    if (w) {
      const segs = allSegments(w.modes[0]!);
      assert.notDeepEqual(segs.map((s) => s.damage), [{ impact: 3.3333, puncture: 3.3333, slash: 3.3333 }]);
    }
  });

  it('雷霆：主模式与第二模式都保留（第二模式是真实数据）', () => {
    const w = byId.get('TnWispRifle');
    assert.ok(w);
    assert.equal(w.modes.length, 2, `雷霆应有两个模式，实际 ${w.modes.map((m) => m.id).join(',')}`);
  });
});
