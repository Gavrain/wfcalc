import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveFromExport,
  resolveFromZkClass,
  compatibleModKinds,
  canEquipMod,
  normalizeKey,
} from '../src/mods/weapon-slots.ts';
import { lookupExaltedSlots } from '../../data/src/manual/exalted-slots.ts';

describe('跨数据源名称归一化', () => {
  it('大小写与符号差异都能对上（Ogris / ogris、MK1-Paris / mk1_paris）', () => {
    assert.equal(normalizeKey('Ogris'), normalizeKey('ogris'));
    assert.equal(normalizeKey('MK1-Paris'), normalizeKey('mk1_paris'));
    assert.equal(normalizeKey('Kuva Bramma'), normalizeKey('kuvabramma'));
  });
});

describe('ZK 武器库 → Mod 槽位', () => {
  it('霰弹枪', () => {
    const r = resolveFromZkClass({ i: 'strun', n: 'Strun', s: 'p', c: 'shotgun' });
    assert.equal(r?.broad, 'shotgun');
    assert.deepEqual(compatibleModKinds(r!), ['shotgun', 'primary']);
  });

  it('弓类同时可装步枪系通用模组', () => {
    const r = resolveFromZkClass({ i: 'dread', n: 'Dread', s: 'p', c: 'bow' });
    assert.deepEqual(compatibleModKinds(r!).sort(), ['bow', 'primary', 'rifle']);
  });

  it('狙击枪可装步枪系模组', () => {
    const r = resolveFromZkClass({ i: 'rubico', n: 'Rubico', s: 'p', c: 'sniper' });
    assert.ok(compatibleModKinds(r!).includes('rifle'));
  });

  it('霰弹手枪走手枪类（Bronco）', () => {
    const r = resolveFromZkClass({ i: 'bronco', n: 'Bronco', s: 's', c: 'shotgun_sidearm' });
    assert.equal(r?.broad, 'pistol');
  });

  it('发射器走步枪类（Bramma / Ogris）', () => {
    const r = resolveFromZkClass({ i: 'kuva_bramma', n: 'Kuva Bramma', s: 'p', c: 'launcher' });
    assert.equal(r?.broad, 'rifle');
  });

  it('近战区分类型：剑给出 sword 细类，同时保留 melee 宽类（D-001）', () => {
    const r = resolveFromZkClass({ i: 'skana', n: 'Skana', s: 'm', c: 'sword' });
    assert.equal(r.broad, 'melee');
    assert.deepEqual(r.specific, ['sword']);
    const kinds = compatibleModKinds(r);
    assert.ok(kinds.includes('melee'), '通用近战 Mod 应可装');
    assert.ok(kinds.includes('sword'), '剑类 Mod 应可装');
  });

  it('不同的近战类型互不通用', () => {
    const sword = resolveFromZkClass({ i: 'skana', n: 'Skana', s: 'm', c: 'sword' });
    const nikana = resolveFromZkClass({ i: 'nikana', n: 'Nikana', s: 'm', c: 'nikana' });
    // 剑类 Mod 不能装到尼卡纳上，反之亦然
    assert.equal(canEquipMod(sword, 'nikana'), false);
    assert.equal(canEquipMod(nikana, 'sword'), false);
    // 但通用近战 Mod 两边都能装
    assert.equal(canEquipMod(sword, 'melee'), true);
    assert.equal(canEquipMod(nikana, 'melee'), true);
    assert.equal(canEquipMod(sword, 'sword'), true);
    assert.equal(canEquipMod(nikana, 'nikana'), true);
  });

  it('ZK 只给宽类 melee 时，用官方 STANCE 标签补细类', () => {
    const r = resolveFromZkClass({ i: 'x', n: 'X', s: 'm', c: 'melee' }, ['GLAIVES_STANCE']);
    assert.equal(r.broad, 'melee');
    assert.deepEqual(r.specific, ['glaive']);
    assert.equal(r.source, 'stance-tags');
  });

  it('空战武器', () => {
    const r = resolveFromZkClass({ i: 'imperator', n: 'Imperator', s: 'a', c: 'archgun' });
    assert.equal(r.broad, 'archgun');
    assert.deepEqual(compatibleModKinds(r), ['archgun']);
  });
});

describe('官方导出兜底（ZK 库里没有的新武器）', () => {
  it('holsterCategory=SHOTGUN → shotgun', () => {
    const r = resolveFromExport({ productCategory: 'LongGuns', holsterCategory: 'SHOTGUN' });
    assert.equal(r.broad, 'shotgun');
    assert.equal(r.source, 'holster');
    assert.equal(r.unresolved, false);
  });

  it('holsterCategory=BOW → bow', () => {
    assert.equal(resolveFromExport({ productCategory: 'LongGuns', holsterCategory: 'BOW' }).broad, 'bow');
  });

  it('手枪缺 holsterCategory 时按产品大类退回 pistol', () => {
    const r = resolveFromExport({ productCategory: 'Pistols' });
    assert.equal(r.broad, 'pistol');
    assert.equal(r.source, 'product-category');
  });

  it('近战用 *_STANCE 标签补出细类（D-001）', () => {
    const r = resolveFromExport({ productCategory: 'Melee', compatibilityTags: ['HAMMERS_STANCE'] });
    assert.equal(r.broad, 'melee');
    assert.deepEqual(r.specific, ['hammer']);
    assert.equal(canEquipMod(r, 'hammer'), true);
    assert.equal(canEquipMod(r, 'sword'), false);
  });

  it('近战标签是 "HEAVY SCYTHE_STANCE" 这种带空格的也能认', () => {
    const r = resolveFromExport({ productCategory: 'Melee', compatibilityTags: ['HEAVY SCYTHE_STANCE'] });
    assert.deepEqual(r.specific, ['heavy_scythe']);
  });

  it('显赫武器可装 Mod，但武器类标为待人工确认', () => {
    const r = resolveFromExport({
      productCategory: 'SpecialItems',
      holsterCategory: 'MELEE',
      compatibilityTags: ['POWER_WEAPON'],
    });
    assert.equal(r.broad, 'melee');
    assert.equal(r.unresolved, true);
  });

  it('哨兵枪械不参与 Mod 配装，记为待确认', () => {
    const r = resolveFromExport({ productCategory: 'SentinelWeapons', holsterCategory: 'SNIPER' });
    assert.equal(r.unresolved, true);
  });

  it('空战近战 / 空战枪械按产品大类直判', () => {
    assert.equal(resolveFromExport({ productCategory: 'SpaceGuns' }).broad, 'archgun');
    assert.equal(resolveFromExport({ productCategory: 'SpaceMelee' }).broad, 'archmelee');
  });
});

describe('哨兵 / 猎犬武器不参与配装', () => {
  it('即使 ZK 库里把它标主武器，带 SENTINEL_WEAPON 标签也要判为待确认', () => {
    const r = resolveFromZkClass({ i: 'artax', n: 'Artax', s: 'p', c: 'rifle' }, ['SENTINEL_WEAPON']);
    assert.equal(r.unresolved, true);
  });

  it('猎犬近战武器（HOUND_WEAPON）同样待确认，但保留近战宽类', () => {
    const r = resolveFromZkClass({ i: 'batoten', n: 'Batoten', s: 'm', c: 'melee' }, ['HOUND_WEAPON']);
    assert.equal(r.unresolved, true);
    assert.equal(r.broad, 'melee');
  });
});

describe('显赫武器的人工槽位表', () => {
  it('近战显赫一律归 melee（不看剑/爪细类）', () => {
    for (const name of ['Exalted Blade', 'Valkyr Talons', 'Iron Staff', 'Whipclaw', 'Landslide Fists']) {
      const o = lookupExaltedSlots(name);
      assert.ok(o, `${name} 应已登记`);
      assert.equal(o.broad, 'melee', `${name} 应归 melee`);
    }
  });

  it('枪械类显赫归到对应的枪（小仙女之枪 → 手枪）', () => {
    const o = lookupExaltedSlots('Dex Pixia');
    assert.ok(o);
    assert.equal(o.broad, 'pistol');
  });

  it('未登记的武器返回 null（流水线会列入待人工确认）', () => {
    assert.equal(lookupExaltedSlots('某个不存在的武器'), null);
  });
});
