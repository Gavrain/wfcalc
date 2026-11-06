/**
 * 赋能 / Mod 的武器适用范围（D-138 + 需求方 2026-07-11 补充）。
 *
 * 需求方原话：
 * > 「霰弹枪仅限主手，副手就算是霰弹模式也算副手，因为他们的可安装 mod 和赋能没区别。」
 * > 「弩不能装弓箭类 mod 和赋能。」
 *
 * 这里只测纯函数 `arcaneCategoriesFor` / `isArcaneUsableOn`，不跑页面。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { arcaneCategoriesFor, isArcaneUsableOn } from '../public/app-data.js';

const SHOTGUN_ARCANE = { name: { zh: '霰弹·仇杀' }, category: 'secondary', key: 'ShotgunMultishotAndReloadSpeedOnCloseKill' };
const BOW_ARCANE = { name: { zh: '弓箭·某某' }, category: 'bow', key: 'bow-x' };
const PRIMARY_ARCANE = { name: { zh: '主要·无情' }, category: 'primary', key: 'Primary-x' };
const SECONDARY_ARCANE = { name: { zh: '次要·某某' }, category: 'secondary', key: 'Secondary-x' };
const DUAL_ARCANE = { name: { zh: '双枪·某某' }, category: 'secondary', key: 'dual-x' };

const primary = { category: 'primary' };
const secondary = { category: 'secondary' };

describe('霰弹枪仅限主手', () => {
  it('主手霰弹枪（broad = shotgun）可装 霰弹· + 主要·', () => {
    const entry = { slots: { broad: 'shotgun' }, modKinds: ['shotgun', 'primary'] };
    assert.deepEqual(arcaneCategoriesFor(primary, entry), ['shotgun', 'primary']);
    assert.equal(isArcaneUsableOn(SHOTGUN_ARCANE, primary, entry), true);
  });

  it('副手即使有霰弹模式也只算副手：不拿 霰弹·', () => {
    // 野马双枪 / 布拉克这类副手霰弹：broad 仍是 pistol
    const entry = { slots: { broad: 'pistol', basis: { tags: ['SECONDARYSHOTGUN'], holster: 'PISTOL' } } };
    assert.deepEqual(arcaneCategoriesFor(secondary, entry), ['secondary']);
    assert.equal(isArcaneUsableOn(SHOTGUN_ARCANE, secondary, entry), false);
    assert.equal(isArcaneUsableOn(SECONDARY_ARCANE, secondary, entry), true);
  });

  it('副手双持额外拿 双枪·，但仍不算霰弹', () => {
    const entry = { slots: { broad: 'pistol' }, isDualPistols: true };
    assert.deepEqual(arcaneCategoriesFor(secondary, entry), ['secondary', 'dual']);
    assert.equal(isArcaneUsableOn(DUAL_ARCANE, secondary, entry), true);
    assert.equal(isArcaneUsableOn(SHOTGUN_ARCANE, secondary, entry), false);
  });
});

describe('弓与弩的赋能区别', () => {
  it('真弓拿 弓箭· + 主要·', () => {
    const entry = { slots: { broad: 'bow' }, trueBow: true };
    assert.deepEqual(arcaneCategoriesFor(primary, entry), ['bow', 'primary']);
    assert.equal(isArcaneUsableOn(BOW_ARCANE, primary, entry), true);
  });

  it('弩只有 主要·，不拿 弓箭·', () => {
    const entry = { slots: { broad: 'rifle' }, subclass: 'crossbow' };
    assert.deepEqual(arcaneCategoriesFor(primary, entry), ['primary']);
    assert.equal(isArcaneUsableOn(BOW_ARCANE, primary, entry), false);
    assert.equal(isArcaneUsableOn(PRIMARY_ARCANE, primary, entry), true);
  });
});
