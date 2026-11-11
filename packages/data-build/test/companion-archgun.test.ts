/**
 * D-145 / D-146 回归：数据刷新后的收录与归类规则。
 *
 * 需求方 2026-11-08 逐条确认：
 *   1. 航道星舰炮台（CrewShipWeapons）**永久不收**；
 *   2. 守护武器与角色武器共用同一套 Mod（步枪 / 近战 / 霰弹…），没有守护专用 Mod；
 *   3. 无 holster 的「激光点发」系列按名字归手枪；伽拉之爪归近战爪；
 *   4. 能恢复的 impact 段全部恢复（预言者这类「投射组只有 procChance」的武器）。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  EXCLUDED_CATEGORIES,
  cleanWeapons,
  impactMatchesPanelTotal,
  isPlaceholder,
  projectileHasDamage,
} from '../src/clean.ts';
import type { ExportWeapons } from '../src/types.ts';

function weapon(over: Partial<ExportWeapons[string]>): ExportWeapons[string] {
  return {
    name: '/Lotus/Language/Items/TestName',
    totalDamage: 0,
    damagePerShot: [],
    criticalChance: 0,
    criticalMultiplier: 1,
    procChance: 0,
    fireRate: 1,
    productCategory: 'Pistols',
    behaviours: [],
    ...over,
  };
}

describe('D-145 航道星舰炮台不收', () => {
  it('CrewShipWeapons 在排除分类里', () => {
    assert.equal(EXCLUDED_CATEGORIES.includes('CrewShipWeapons'), true);
  });

  it('航道星舰炮台条目被分类过滤掉，不产生武器', () => {
    const raw: ExportWeapons = {
      '/Lotus/Weapons/CrewShip/Blaster': weapon({
        productCategory: 'CrewShipWeapons',
        totalDamage: 80,
        damagePerShot: [80],
        behaviours: [{ impact: { DT_IMPACT: 80, procChance: 0.12 } }],
      }),
    };
    const r = cleanWeapons(raw);
    assert.equal(r.weapons.length, 0);
    assert.equal(r.stats.excludedByCategory, 1);
  });
});

describe('D-145 「投射组只有 procChance」时 impact 是真伤害', () => {
  // 预言者：projectile.attack 只有 procChance，真伤害是 impact 8.33×3
  const seer = {
    fireIterations: 1,
    projectile: { attack: { procChance: 0.13 } },
    impact: { DT_IMPACT: 8.333325, DT_PUNCTURE: 8.333325, DT_SLASH: 8.333351, procChance: 0.1 },
  };

  it('projectileHasDamage：只有 procChance 的投射组不算有伤害', () => {
    assert.equal(projectileHasDamage(seer), false);
  });

  it('impactMatchesPanelTotal：单发 25.0 × 3 弹头 ≈ 面板 101', () => {
    const panel = [33.666668, 33.666668, 33.666664, ...Array(17).fill(0)];
    assert.equal(impactMatchesPanelTotal(seer.impact, panel), true);
  });

  it('预言者不再被判成占位', () => {
    const panel = [33.666668, 33.666668, 33.666664, ...Array(17).fill(0)];
    assert.equal(isPlaceholder(seer, { primary: true, damagePerShot: panel, weaponProcChance: 0.13 }), false);
  });

  it('真正的模板段（3.33×3 @0.1，面板是 130 冲击）仍判占位', () => {
    const stub = { fireIterations: 1, impact: { DT_IMPACT: 3.33333, DT_PUNCTURE: 3.33333, DT_SLASH: 3.33334, procChance: 0.1 } };
    assert.equal(isPlaceholder(stub, { primary: true, damagePerShot: [130, ...Array(19).fill(0)], weaponProcChance: 0.25 }), true);
  });
});

describe('D-145 只有 impact 段的近战武器保留', () => {
  for (const [id, dmg, proc] of [
    ['EntSphereHammer', 340, 0.15],
    ['TnoNunchaku', 180, 0.34],
    ['EntFistIncarnon', 170, 0.2],
  ] as const) {
    it(`${id}（单类型冲击 ${dmg}）不被丢弃`, () => {
      const raw: ExportWeapons = {
        [`/Lotus/Weapons/Test/${id}`]: weapon({
          productCategory: 'Melee',
          totalDamage: dmg,
          damagePerShot: [dmg, ...Array(19).fill(0)],
          procChance: proc,
          behaviours: [{ fireIterations: 1, impact: { DT_IMPACT: dmg, procChance: proc } }],
        }),
      };
      const r = cleanWeapons(raw);
      assert.equal(r.weapons.length, 1, id);
      assert.equal(r.weapons[0]!.modes.length, 1, id);
    });
  }
});
