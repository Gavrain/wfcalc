/**
 * D-078 / D-079 回归：数据清洗的两条剔除规则。
 *
 * D-078 `embedDeathAttack` 是**碎尸比例**（总额恒 100，与伤害无关）→ 不收录成独立段。
 *        之前把它当成第 4 段，Astilla Prime 单发 343（实际 243 / WFCD 240）。
 * D-079 `impact = 单元素小额`（腐蚀 3, procChance 0.3）是**占位符** → 段级过滤。
 *        之前被当成真实伤害，10 把武器多算 3 点腐蚀。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isTinySingleTypePlaceholder, isImpactPlaceholder, isUniformPhysicalPlaceholder } from '../src/clean.ts';
import { cleanWeapons } from '../src/clean.ts';
import { allSegments } from '../../core/src/weapon.ts';
import type { ExportWeapons, ExportAttack } from '../src/types.ts';

describe('D-079 单类型小额占位识别', () => {
  it('腐蚀 3 + procChance 0.3 → 判为占位', () => {
    assert.equal(isTinySingleTypePlaceholder({ DT_CORROSIVE: 3, procChance: 0.3 } as ExportAttack), true);
  });

  it('procChance 缺省时也算（只要单类型且 ≤3）', () => {
    assert.equal(isTinySingleTypePlaceholder({ DT_CORROSIVE: 3 } as ExportAttack), true);
  });

  it('数值大于 3 不算占位（如 腐蚀 5）', () => {
    assert.equal(isTinySingleTypePlaceholder({ DT_CORROSIVE: 5, procChance: 0.3 } as ExportAttack), false);
  });

  it('procChance 不是 0.3 不算占位', () => {
    assert.equal(isTinySingleTypePlaceholder({ DT_CORROSIVE: 3, procChance: 0.1 } as ExportAttack), false);
  });

  it('两个类型不算（只针对单类型）', () => {
    assert.equal(isTinySingleTypePlaceholder({ DT_CORROSIVE: 3, DT_HEAT: 3, procChance: 0.3 } as ExportAttack), false);
  });

  it('真实小额单元素伤害不会被误杀：毒 10 / 电 15', () => {
    for (const a of [{ DT_POISON: 10, procChance: 0.3 }, { DT_ELECTRICITY: 15, procChance: 0.3 }]) {
      assert.equal(isTinySingleTypePlaceholder(a as ExportAttack), false, JSON.stringify(a));
      assert.equal(isImpactPlaceholder(a as ExportAttack), false, JSON.stringify(a));
    }
  });

  it('等值物理占位仍由原规则识别（3.33/3.33/3.33）', () => {
    const p = { DT_IMPACT: 3.33333, DT_PUNCTURE: 3.33333, DT_SLASH: 3.33334, procChance: 0.1 } as ExportAttack;
    assert.equal(isUniformPhysicalPlaceholder(p), true);
    assert.equal(isImpactPlaceholder(p), true);
    assert.equal(isTinySingleTypePlaceholder(p), false); // 三类型，不归单类型规则管
  });
});

describe('D-078 embedDeathAttack 不收录 + D-079 impact 占位过滤', () => {
  /** 复刻 Astilla Prime 的原始导出结构 */
  function astillaLike(): ExportWeapons {
    return {
      '/Lotus/Weapons/Tenno/LongGuns/PrimeAstilla/AstillaPrimeWeapon': {
        name: '/Lotus/Language/Weapons/PrimeAstillaName',
        productCategory: 'LongGuns',
        multishot: 1,
        behaviours: [
          {
            stateName: '/Lotus/Language/Menu/Loadout_TriggerAuto',
            fireIterations: 1,
            impact: { DT_CORROSIVE: 3, procChance: 0.3 } as ExportAttack,
            projectile: {
              attack: { DT_IMPACT: 100, procChance: 0.37 } as ExportAttack,
              explosiveAttack: { DT_PUNCTURE: 48.999999, DT_SLASH: 90.999997, procChance: 0.37 } as ExportAttack,
              embedDeathAttack: { DT_PUNCTURE: 22, DT_SLASH: 77.999997, procChance: 0.22 } as ExportAttack,
            },
          },
        ],
      },
    } as unknown as ExportWeapons;
  }

  it('Astilla Prime：只保留 attack + explosiveAttack 两段', () => {
    const r = cleanWeapons(astillaLike());
    assert.equal(r.weapons.length, 1);
    const segs = allSegments(r.weapons[0]!.modes[0]!);
    assert.equal(segs.length, 2, `实际 ${segs.map((s) => s.kind).join(',')}`);
    assert.deepEqual(segs.map((s) => s.kind), ['attack', 'explosiveAttack']);
  });

  it('单发合计 = 240（不是把 embedDeath 也算进去的 343）', () => {
    const r = cleanWeapons(astillaLike());
    const segs = allSegments(r.weapons[0]!.modes[0]!);
    const total = segs.reduce<number>((a, s) => a + Object.values(s.damage).reduce<number>((x, y) => x + (y ?? 0), 0), 0);
    assert.ok(Math.abs(total - 240) < 0.01, `实际 ${total}`);
  });

  it('impact 的腐蚀 3 被过滤掉，不进入任何段', () => {
    const r = cleanWeapons(astillaLike());
    const segs = allSegments(r.weapons[0]!.modes[0]!);
    for (const s of segs) {
      assert.equal(s.damage.corrosive, undefined, `段 ${s.kind} 不应有腐蚀伤害`);
    }
  });
});
