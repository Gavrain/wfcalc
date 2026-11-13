/**
 * 灵化射线人工表（D-160）的回归测试。
 *
 * 需求方 2026-11-12：
 * > 「那就所有普通模式，包括主要模式和次要射击都用 held 来判断，
 * >   灵化武器则单独记表，因为灵化武器更新很少。」
 * > 「盗贼 赘骨 野猪 托里德的灵化是射线，注意赘骨的两个 charge 不是射线。」
 * > 「但是布莱顿又不是射线，你这样也不对」
 *
 * 锁住四件事：
 *   1. 表里的灵化攻击 → `beam: true`、变体扳机 `held`；
 *   2. 表外的灵化（布莱顿）**不变**，仍是实弹；
 *   3. 赘骨只有 `Held` 那条是射线，两个 `Charge` 仍是蓄力 / 爆炸；
 *   4. 数据里不再有无差别的 `beam: false`（旧规则把所有非 Hit-Scan 段都盖章成"不是射线"）。
 *
 * 用最小构造数据，不依赖网络；真实武器的数值核对见 `packages/core/test/torid-incarnon-bean.test.ts`。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cleanWfcdWeapons, type WfcdWeapon, type WfcdAttack } from '../src/wfcd-clean.ts';
import { INCARNON_BEAM_ATTACKS, isIncarnonBeamAttack } from '../../data/src/manual/incarnon-beam.ts';

function weapon(over: Partial<WfcdWeapon> & { name: string; attacks: WfcdAttack[] }): WfcdWeapon {
  return {
    uniqueName: `/Lotus/Weapons/Test/${over.name.replace(/\s+/g, '')}`,
    productCategory: 'LongGuns',
    criticalChance: 0.2,
    criticalMultiplier: 2,
    procChance: 0.2,
    fireRate: 6,
    multishot: 1,
    ...over,
  } as WfcdWeapon;
}

const modesOf = (w: WfcdWeapon) => cleanWfcdWeapons([w]).weapons[0]!.modes;

/** 取灵化模式里标签含某字的变体 */
function variantOf(modes: ReturnType<typeof modesOf>, label: string) {
  const inc = modes.find((m) => m.role === 'incarnon');
  assert.ok(inc, '应有灵化模式');
  const v = inc!.variants.find((x) => String(x.label).includes(label));
  assert.ok(v, `应有「${label}」变体，实际：${inc!.variants.map((x) => x.label).join(' / ')}`);
  return v!;
}

test('射线表：就是需求方点名的五条（托里德 / 野猪 x2 / 盗贼 / 赘骨）', () => {
  const names = INCARNON_BEAM_ATTACKS.map((e) => `${e.weapon}:${e.attacks.join('+')}`);
  assert.deepEqual(names, [
    'Torid:Incarnon Form',
    'Boar:Incarnon Form',
    'Boar Prime:Incarnon Form',
    'Onos:Incarnon Form Held Damage',
    'Furis:Incarnon Form',
  ]);
});

test('表里没有布莱顿：灵化实弹不算射线', () => {
  assert.equal(isIncarnonBeamAttack('Braton Prime', 'Incarnon Form'), false);
  assert.equal(isIncarnonBeamAttack('Torid', 'Incarnon Form'), true);
  assert.equal(isIncarnonBeamAttack('Torid', 'Poison Cloud'), false);
});

test('托里德：灵化那条判成射线（WFCD 只给 Hit-Scan，靠表点名）', () => {
  const modes = modesOf(
    weapon({
      name: 'Torid',
      trigger: 'Semi',
      attacks: [
        { name: 'Grenade Impact', shot_type: 'Projectile', damage: { toxin: 100 } },
        { name: 'Poison Cloud', shot_type: 'AoE', damage: { toxin: 40 } },
        { name: 'Incarnon Form', shot_type: 'Hit-Scan', damage: { toxin: 51 } },
      ],
    }),
  );
  const v = variantOf(modes, '直接命中');
  assert.equal(v.trigger, 'held', '灵化变体应落成 held');
  assert.equal(v.segments[0]!.beam, true, '灵化段应标成射线');
  // 普通模式不受影响：毒榴弹命中 / 毒云都不是射线
  const primary = modes.find((m) => m.role === 'normal')!;
  for (const pv of primary.variants) {
    assert.equal(pv.segments[0]!.beam, undefined, `普通模式 ${pv.label} 不该带 beam 标记`);
    assert.notEqual(pv.trigger, 'held');
  }
});

test('野猪：灵化判成射线', () => {
  const modes = modesOf(
    weapon({
      name: 'Boar',
      trigger: 'Auto',
      attacks: [
        { name: 'Normal Attack', shot_type: 'Hit-Scan', damage: { impact: 12.1 } },
        { name: 'Incarnon Form', shot_type: 'Hit-Scan', damage: { heat: 20 } },
      ],
    }),
  );
  const v = variantOf(modes, '直接命中');
  assert.equal(v.trigger, 'held');
  assert.equal(v.segments[0]!.beam, true);
});

test('布莱顿：灵化**不是**射线，保持实弹（需求方：布莱顿又不是射线）', () => {
  const modes = modesOf(
    weapon({
      name: 'Braton Prime',
      trigger: 'Auto',
      attacks: [
        { name: 'Normal Attack', shot_type: 'Hit-Scan', damage: { impact: 1.75, slash: 21 } },
        { name: 'Incarnon Form', shot_type: 'Hit-Scan', damage: { impact: 28, slash: 39.2 } },
        { name: 'Incarnon Form AoE', shot_type: 'AoE', damage: { heat: 70 } },
      ],
    }),
  );
  const v = variantOf(modes, '直接命中');
  assert.notEqual(v.trigger, 'held');
  assert.equal(v.segments[0]!.beam, undefined);
});

test('赘骨：只有 Held 那条是射线，两个 Charge 不是', () => {
  const modes = modesOf(
    weapon({
      name: 'Onos',
      trigger: 'Auto',
      attacks: [
        { name: 'Normal Attack', shot_type: 'Projectile', damage: { puncture: 220 } },
        // WFCD 把这条射线记成了 Projectile——名字才是准的
        { name: 'Incarnon Form Held Damage', shot_type: 'Projectile', damage: { radiation: 30 } },
        { name: 'Incarnon Form Charge Attack', shot_type: 'Hit-Scan', damage: { heat: 2200 } },
        { name: 'Incarnon Form Charge Radial Attack', shot_type: 'AoE', damage: { heat: 1100 } },
      ],
    }),
  );
  const beam = variantOf(modes, '射线');
  assert.equal(beam.trigger, 'held');
  assert.equal(beam.segments[0]!.beam, true);

  const charge = variantOf(modes, '蓄力');
  assert.equal(charge.trigger, 'charge', '蓄力本体不能被算成射线');
  assert.equal(charge.segments[0]!.beam, undefined);

  const radial = variantOf(modes, '范围伤害');
  assert.equal(radial.trigger, 'charge');
  assert.equal(radial.segments[0]!.beam, undefined);
  assert.equal(radial.segments[0]!.aoe, true);
});

test('不再有无差别的 beam:false：普通 Hitscan 命中也保持"跟随扳机"', () => {
  const modes = modesOf(
    weapon({
      name: 'Braton Prime',
      trigger: 'Auto',
      attacks: [{ name: 'Normal Attack', shot_type: 'Hit-Scan', damage: { impact: 1.75 } }],
    }),
  );
  for (const v of modes[0]!.variants) {
    for (const s of v.segments) {
      assert.equal(s.beam, undefined, '普通模式段不该被写 beam（旧规则会盖章成 false）');
    }
  }
});
