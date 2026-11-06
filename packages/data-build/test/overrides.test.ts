import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chargeTimeToFireRate, applyOverrides } from '../src/overrides.ts';
import type { Weapon } from '../../core/src/weapon.ts';

describe('蓄力时间反推射速', () => {
  it('蓄力 0.5s → 射速 2（需求方给出的规则）', () => {
    assert.equal(chargeTimeToFireRate(0.5), 2);
  });

  it('蓄力 1s → 射速 1', () => {
    assert.equal(chargeTimeToFireRate(1), 1);
  });

  it('蓄力 0.25s → 射速 4', () => {
    assert.equal(chargeTimeToFireRate(0.25), 4);
  });

  it('蓄力 0 或负数返回 0', () => {
    assert.equal(chargeTimeToFireRate(0), 0);
    assert.equal(chargeTimeToFireRate(-1), 0);
  });
});

const fake = (id: string, fireRate: number): Weapon => ({
  id,
  name: id,
  category: 'primary',
  critChance: 0.2,
  critMultiplier: 2,
  statusChance: 0.1,
  fireRate,
  modes: [],
});

describe('人工覆盖层', () => {
  it('只对导出射速为 0 的武器应用蓄力反推', () => {
    const weapons = [fake('Railgun', 0), fake('Rifle', 8.75)];
    const applied = applyOverrides(weapons, { Railgun: { chargeTime: 0.5 } });
    assert.equal(weapons[0]!.fireRate, 2);
    assert.equal(weapons[1]!.fireRate, 8.75);
    assert.equal(applied.length, 1);
    assert.equal(applied[0]!.weaponId, 'Railgun');
  });

  it('武器不存在时跳过，不报错', () => {
    const weapons = [fake('Rifle', 8.75)];
    const applied = applyOverrides(weapons, { NotAWeapon: { chargeTime: 1 } });
    assert.equal(applied.length, 0);
  });

  it('可直接指定射速覆盖', () => {
    const weapons = [fake('X', 5)];
    applyOverrides(weapons, { X: { fireRate: 3 } });
    assert.equal(weapons[0]!.fireRate, 3);
  });

  it('可覆盖暴击相关字段', () => {
    const weapons = [fake('X', 5)];
    applyOverrides(weapons, { X: { critChance: 0.5, critMultiplier: 3 } });
    assert.equal(weapons[0]!.critChance, 0.5);
    assert.equal(weapons[0]!.critMultiplier, 3);
  });
});
