/** 验证 D-080：变体级面板覆盖生效，且每个变体独立。 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { panelStats } from '../src/weapon.ts';
import type { Weapon } from '../src/weapon.ts';
import { activeVariant } from '../src/weapon.ts';
import { modeWithSegments } from './_helpers.ts';

const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

function multiVariantWeapon(): Weapon {
  return {
    id: 'MultiVariant',
    name: 'Multi Variant',
    category: 'primary',
    critChance: 0.2,
    critMultiplier: 2,
    statusChance: 0.3,
    fireRate: 10,
    magazineSize: 30,
    reloadTime: 2,
    modes: [
      {
        id: 'primary',
        role: 'normal',
        trigger: 'auto',
        bullets: 1,
        multishot: 1,
        variants: [
          {
            id: 'direct',
            label: '直接命中',
            segments: [{ kind: 'attack', aoe: false, procChance: 0.3, damage: { impact: 100 } }],
            // 直接命中：面板触发 30%
          },
          {
            id: 'blast',
            label: '爆炸',
            segments: [{ kind: 'explosiveAttack', aoe: true, procChance: 0.2, damage: { blast: 140 } }],
            // 爆炸：触发与暴击都不同（这正是需求方说的「有的模式触发与暴击不一致」）
            override: { statusChance: 0.5, critChance: 0.35, critMultiplier: 2.5 },
          },
        ],
      },
    ],
  };
}

describe('D-080 变体级独立面板', () => {
  it('单段模式只有 1 个变体，界面不显示切换', () => {
    const w: Weapon = {
      ...multiVariantWeapon(),
      modes: [modeWithSegments(
        { id: 'primary', role: 'normal', trigger: 'auto', bullets: 1, multishot: 1 },
        [{ kind: 'impact', aoe: false, procChance: 0.3, damage: { impact: 100 } }],
      )],
    };
    assert.equal(w.modes[0]!.variants.length, 1);
    assert.equal(w.modes[0]!.variants[0]!.id, 'direct');
  });

  it('命中与爆炸各自持有自己的段（不共享）', () => {
    const m = multiVariantWeapon().modes[0]!;
    assert.equal(m.variants.length, 2);
    const [direct, blast] = m.variants;
    assert.equal(direct!.segments[0]!.kind, 'attack');
    assert.equal(blast!.segments[0]!.kind, 'explosiveAttack');
    assert.deepEqual(Object.keys(direct!.segments[0]!.damage), ['impact']);
    assert.deepEqual(Object.keys(blast!.segments[0]!.damage), ['blast']);
  });

  it('变体级 override 生效：爆炸的触发/暴击与命中不同', () => {
    const w = multiVariantWeapon();
    const m = w.modes[0]!;
    const direct = panelStats(w, m, activeVariant(m, 'direct'));
    const blast = panelStats(w, m, activeVariant(m, 'blast'));
    near(direct.statusChance, 0.3, 1e-12);   // 回退武器级
    near(blast.statusChance, 0.5, 1e-12);    // 变体覆盖
    near(direct.critChance, 0.2, 1e-12);
    near(blast.critChance, 0.35, 1e-12);
    near(direct.critMultiplier, 2, 1e-12);
    near(blast.critMultiplier, 2.5, 1e-12);
  });

  it('取值顺序：变体 override → 模式 override → 武器级', () => {
    const w = multiVariantWeapon();
    // 给模式加一层 override，变体没写的字段应回退到模式级
    const m = {
      ...w.modes[0]!,
      override: { fireRate: 6, statusChance: 0.44 },
    };
    const direct = panelStats(w, m, activeVariant(m, 'direct'));
    // 直接命中没有自己的 override → 触发率取模式级 0.44
    near(direct.statusChance, 0.44, 1e-12);
    near(direct.fireRate, 6, 1e-12);
    // 爆炸有自己的触发率 0.5 → 优先于模式级
    const blast = panelStats(w, m, activeVariant(m, 'blast'));
    near(blast.statusChance, 0.5, 1e-12);
    near(blast.fireRate, 6, 1e-12);
  });

  it('activeVariant 找不到指定 id 时回退第一个', () => {
    const m = multiVariantWeapon().modes[0]!;
    assert.equal(activeVariant(m, 'nonexistent').id, 'direct');
    assert.equal(activeVariant(m).id, 'direct');
  });
});
