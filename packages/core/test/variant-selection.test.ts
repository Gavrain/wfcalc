/**
 * 攻击方式多选（D-148 / 需求方 2026-11-12）。
 *
 * 需求方原话：
 * > 「灵化只有一个，那是一个灵化模式下的多个攻击方式，打出去有弹头命中跟爆炸伤害。」
 * > 「要加入复选框，可以选择加入计算的攻击段，ui 可以像切换统计口径那样，选中的高亮。」
 *
 * 这组测试锁住三件事：
 *   1. **灵化永远只有一个模式**，其下的多种攻击方式是 `variants`，不是独立模式；
 *   2. 同一模式内两种扳机并存（赘骨灵化：射线 + 蓄力）时，扳机写在攻击方式上；
 *   3. `compute()` 按选中的攻击方式计算——全选 = 各段相加，只选一种 = 只算那一种。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { compute } from '../src/compute.ts';
import type { AttackMode, ModeVariant, Weapon } from '../src/weapon.ts';

/** 造一把带灵化模式的武器：本体 10 冲击；灵化 = 弹头命中 20 火焰 + 爆炸 30 火焰 */
function buildWeapon(withBlast = true): { weapon: Weapon; mode: AttackMode } {
  const incarnonVariants: ModeVariant[] = [
    {
      id: 'direct',
      label: '灵化',
      trigger: 'held',
      segments: [{ kind: 'attack', damage: { heat: 20 }, procChance: 0.3, aoe: false }],
    },
  ];
  if (withBlast) {
    incarnonVariants.push({
      id: 'blast',
      label: '灵化·爆炸',
      trigger: 'charge',
      segments: [{ kind: 'explosiveAttack', damage: { heat: 30 }, procChance: 0.3, aoe: true }],
    });
  }

  const modes: AttackMode[] = [
    {
      id: 'primary',
      role: 'normal',
      trigger: 'auto',
      bullets: 1,
      multishot: 1,
      variants: [
        { id: 'direct', label: '直接命中', segments: [{ kind: 'attack', damage: { impact: 10 }, procChance: 0.2, aoe: false }] },
      ],
    },
    {
      id: 'incarnon',
      role: 'incarnon',
      trigger: 'held',
      bullets: 1,
      multishot: 1,
      variants: incarnonVariants as AttackMode['variants'],
    },
  ];

  const weapon: Weapon = {
    id: 'TestIncarnon',
    name: 'Test',
    category: 'primary',
    critChance: 0.1,
    critMultiplier: 2,
    statusChance: 0.3,
    fireRate: 10,
    magazineSize: 30,
    reloadTime: 2,
    modes,
  };
  return { weapon, mode: modes[1]! };
}

const sumHit = (res: ReturnType<typeof compute>): number =>
  Object.values(res.totalSpread).reduce((a: number, b) => a + (b ?? 0), 0);

describe('灵化只有一个模式，其下是多种攻击方式（D-148）', () => {
  it('灵化的「命中 + 爆炸」是同一模式的两个攻击方式，不是两个模式', () => {
    const { weapon } = buildWeapon();
    assert.equal(weapon.modes.filter((m) => m.role === 'incarnon').length, 1, '灵化只能有一个模式');
    const inc = weapon.modes.find((m) => m.role === 'incarnon')!;
    assert.equal(inc.variants.length, 2, '灵化模式内应有 2 种攻击方式');
    assert.deepEqual(inc.variants.map((v) => v.id), ['direct', 'blast']);
  });

  it('同一模式内两种扳机并存时，扳机写在攻击方式上（赘骨：射线 + 蓄力）', () => {
    const { mode } = buildWeapon();
    assert.equal(mode.trigger, 'held', '模式扳机取主体那个');
    assert.equal(mode.variants[0]!.trigger, 'held', '第一种攻击方式是射线');
    assert.equal(mode.variants[1]!.trigger, 'charge', '第二种攻击方式是蓄力');
  });
});

describe('按勾选的攻击方式计算（需求方 2026-11-12）', () => {
  it('全选（不传选择）= 各攻击方式之和', () => {
    const { weapon, mode } = buildWeapon();
    const all = compute(weapon, mode, []);
    assert.equal(sumHit(all), 50, '20 火焰 + 30 火焰 = 50');
  });

  it('只选第一种 = 只算那一种', () => {
    const { weapon, mode } = buildWeapon();
    const only = compute(weapon, mode, [], {}, [0]);
    assert.equal(sumHit(only), 20, '只算命中那一段');
  });

  it('只选第二种 = 只算那一种', () => {
    const { weapon, mode } = buildWeapon();
    const only = compute(weapon, mode, [], {}, [1]);
    assert.equal(sumHit(only), 30, '只算爆炸那一段');
  });

  it('传下标单值（旧调用方式）仍然可用', () => {
    const { weapon, mode } = buildWeapon();
    const one = compute(weapon, mode, [], {}, 0);
    assert.equal(sumHit(one), 20);
  });

  it('单选与全选确实不同（复选框要能影响结果）', () => {
    const { weapon, mode } = buildWeapon();
    const all = sumHit(compute(weapon, mode, []));
    const part = sumHit(compute(weapon, mode, [], {}, [0]));
    assert.notEqual(all, part, '取消勾选后数值必须变化');
  });

  it('只有一种攻击方式时，选不选都一样', () => {
    const { weapon, mode } = buildWeapon(false);
    const all = compute(weapon, mode, []);
    const only = compute(weapon, mode, [], {}, [0]);
    assert.equal(sumHit(all), 20);
    assert.equal(sumHit(only), 20);
  });

  it('兼容旧的布尔第 5 参（以前是 beam），不会把模式算空', () => {
    const { weapon, mode } = buildWeapon();
    // @ts-expect-error 故意传布尔，模拟老调用点
    const res = compute(weapon, mode, [], {}, false);
    assert.equal(sumHit(res), 50, '布尔值应视为"全选"，不能算成 0');
  });
});

describe('多段的统计口径各自算完再相加（需求方 2026-11-12）', () => {
  it('单弹头 = 各段单弹头之和（不是只取第一段）', () => {
    const { weapon, mode } = buildWeapon();
    const res = compute(weapon, mode, []);
    const sumOfSegments = res.segments.reduce((a, s) => a + s.line.average, 0);
    assert.equal(res.output.pelletPerHit, sumOfSegments, '单弹头必须是各段之和');
    assert.ok(res.segments.length >= 2, '这段测试需要多段');
  });

  it('爆发伤害 / 持续伤害也按各段之和算', () => {
    const { weapon, mode } = buildWeapon();
    const res = compute(weapon, mode, []);
    const sumOfSegments = res.segments.reduce((a, s) => a + s.line.average, 0);
    const ms = res.output.multishot;
    const fr = res.output.fireRate;
    assert.ok(Math.abs(res.output.perShot - sumOfSegments * ms) < 1e-9, '单次射击 = 各段之和 × 多重');
    assert.ok(Math.abs(res.output.hitDps - sumOfSegments * ms * fr) < 1e-9, '爆发 = 单次射击 × 射速');
  });

  it('只勾一种时，单弹头只等于那一种（不能带上别的段）', () => {
    const { weapon, mode } = buildWeapon();
    const only = compute(weapon, mode, [], {}, [0]);
    const seg0 = only.segments[0]!;
    assert.equal(only.output.pelletPerHit, seg0.line.average);
  });
});
