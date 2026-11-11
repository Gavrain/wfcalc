/**
 * WFCD 清洗路径的回归测试（D-148）。
 *
 * 锁住三类最容易改坏的行为：
 *   1. 射线判定：扳机 Held + Hit-Scan → 射线；同武器的投射物副模式**不是**射线
 *      （幻离子的子母弹曾经被吞进射线主模式，主模式伤害虚高）；
 *   2. 模式划分：`Plasma Bomb` / `Cluster Bombs` 这类弹种切换要独立成模式，
 *      不能并进前一个锚点；
 *   3. 灵化 / Held 攻击名判据（巴什穆、奥诺斯）。
 *
 * 用最小构造数据，不依赖网络。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cleanWfcdWeapons, isHeldAttack, toTrigger, type WfcdWeapon } from '../src/wfcd-clean.ts';

/** 造一把最小的 WFCD 武器 */
function weapon(over: Partial<WfcdWeapon> & { name: string; attacks: WfcdWeapon['attacks'] }): WfcdWeapon {
  return {
    uniqueName: `/Lotus/Weapons/Test/${over.name.replace(/\s+/g, '')}`,
    productCategory: 'LongGuns',
    criticalChance: 0.2,
    criticalMultiplier: 2,
    procChance: 0.2,
    fireRate: 10,
    multishot: 1,
    ...over,
  } as WfcdWeapon;
}

test('扳机映射：Held → held，其余按表', () => {
  assert.equal(toTrigger('Held'), 'held');
  assert.equal(toTrigger('Auto'), 'auto');
  assert.equal(toTrigger('Semi'), 'semi');
  assert.equal(toTrigger('Burst'), 'burst');
  assert.equal(toTrigger('Charge'), 'charge');
  assert.equal(toTrigger('Duplex'), 'charge');
  assert.equal(toTrigger(undefined), 'unknown');
});

test('攻击名含 Held 才算射线形态', () => {
  assert.equal(isHeldAttack('Incarnon Form Held Damage'), true);
  assert.equal(isHeldAttack('Normal Attack'), false);
  assert.equal(isHeldAttack('Held'), true);
});

test('射线武器：Held + Hit-Scan → 该模式判为射线', () => {
  const w = weapon({
    name: 'TestBeam',
    trigger: 'Held',
    attacks: [{ name: 'Normal Attack', shot_type: 'Hit-Scan', damage: { impact: 5, radiation: 10 } }],
  });
  const res = cleanWfcdWeapons([w]);
  assert.equal(res.weapons.length, 1);
  const [m] = res.weapons[0]!.modes;
  assert.equal(m!.trigger, 'held');
  assert.deepEqual(res.weapons[0]!.beamModeIds, ['primary']);
});

test('幻离子形态：射线主模式 + 子母弹副模式，子母弹不算射线', () => {
  // 结构取自真实 WFCD 的 Phantasma：Beam 在前，接着 Plasma Bomb / Cluster Bombs
  const w = weapon({
    name: 'TestPhantasma',
    trigger: 'Held',
    attacks: [
      { name: 'Beam', shot_type: 'Hit-Scan', damage: { impact: 5, radiation: 10 } },
      { name: 'Plasma Bomb Impact', shot_type: 'Projectile', damage: { impact: 15 } },
      { name: 'Plasma Bomb Explosion', shot_type: 'AoE', damage: { radiation: 73 } },
      { name: 'Cluster Bombs Impact', shot_type: 'Projectile', damage: { impact: 3 } },
      { name: 'Cluster Bombs Explosion', shot_type: 'AoE', damage: { radiation: 18 } },
    ],
  });
  const res = cleanWfcdWeapons([w]);
  const got = res.weapons[0]!;
  const modes = got.modes;

  // 主模式只剩射线那一段，**不能**混进子母弹
  const primary = modes.find((m) => m.id === 'primary')!;
  const primarySegs = primary.variants.flatMap((v) => v.segments);
  assert.equal(primarySegs.length, 1, '射线主模式只应有 1 段');
  assert.deepEqual(primarySegs[0]!.damage, { impact: 5, radiation: 10 });

  // 子母弹独立成模式
  assert.ok(modes.length >= 3, `子母弹应独立成模式，实际 ${modes.length} 个模式`);
  // 只有主模式是射线
  assert.deepEqual(got.beamModeIds, ['primary']);
  for (const m of modes) {
    if (m.id === 'primary') continue;
    assert.notEqual(m.trigger, 'held', `模式 ${m.id} 是投射物，不该判成射线`);
  }
});

test('巴什穆形态：武器扳机 Auto，只有名为 Held 的攻击是射线', () => {
  const w = weapon({
    name: 'TestBasmu',
    trigger: 'Auto',
    attacks: [
      { name: 'Normal Attack', shot_type: 'Projectile', damage: { impact: 10 } },
      { name: 'Held', shot_type: 'Hit-Scan', damage: { electricity: 8 } },
    ],
  });
  const res = cleanWfcdWeapons([w]);
  const got = res.weapons[0]!;
  assert.equal(got.beamModeIds.length, 1, '只有 Held 那个模式是射线');
  assert.notEqual(got.beamModeIds[0], 'primary', '主模式是投射物，不是射线');
});

test('普通投射物武器不会被误判成射线', () => {
  const w = weapon({
    name: 'TestRifle',
    trigger: 'Semi',
    attacks: [{ name: 'Normal Attack', shot_type: 'Projectile', damage: { impact: 30 } }],
  });
  const res = cleanWfcdWeapons([w]);
  assert.deepEqual(res.weapons[0]!.beamModeIds, []);
});

test('AoE 攻击标记为范围段', () => {
  const w = weapon({
    name: 'TestLauncher',
    trigger: 'Semi',
    attacks: [
      { name: 'Normal Attack', shot_type: 'Projectile', damage: { impact: 50 } },
      { name: 'Radial Attack', shot_type: 'AoE', damage: { blast: 200 } },
    ],
  });
  const res = cleanWfcdWeapons([w]);
  const segs = res.weapons[0]!.modes[0]!.variants.flatMap((v) => v.segments);
  const aoe = segs.find((s) => s.aoe);
  assert.ok(aoe, '应有一段被标记为 AoE');
  assert.equal(aoe!.kind, 'explosiveAttack');
});
