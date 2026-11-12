import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveFromExport,
  resolveFromZkClass,
  compatibleModKinds,
  canEquipMod,
  exportSubclass,
  isTrueBow,
  normalizeKey,
  resolveFromWfcd,
  isDualPistolByWfcd,
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

  it('弓类同时可装步枪系通用模组（真弓）', () => {
    const r = resolveFromZkClass({ i: 'dread', n: 'Dread', s: 'p', c: 'bow' });
    assert.deepEqual(compatibleModKinds(r!, true).sort(), ['bow', 'primary', 'rifle']);
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

  // 需求方 2026-11-08：「守护武器用的跟角色武器是一样的 mod，只是他们有的分类是步枪有的是近战」
  it('守护枪械按 holsterCategory 归步枪类，与角色武器共用 Mod', () => {
    const sniper = resolveFromExport({ productCategory: 'SentinelWeapons', holsterCategory: 'SNIPER' });
    assert.equal(sniper.broad, 'sniper');
    assert.equal(sniper.unresolved, false);
    assert.deepEqual(compatibleModKinds(sniper), ['sniper', 'rifle', 'primary']);

    const rifle = resolveFromExport({ productCategory: 'SentinelWeapons', holsterCategory: 'RIFLE' });
    assert.equal(rifle.broad, 'rifle');
    assert.equal(rifle.unresolved, false);

    const shotgun = resolveFromExport({ productCategory: 'SentinelWeapons', holsterCategory: 'SHOTGUN' });
    assert.equal(shotgun.broad, 'shotgun');
    assert.equal(shotgun.unresolved, false);
  });

  it('守护近战（分离 / 分离 Prime）归近战类', () => {
    const r = resolveFromExport({ productCategory: 'SentinelWeapons', holsterCategory: 'MELEE' });
    assert.equal(r.broad, 'melee');
    assert.equal(r.unresolved, false);
  });

  it('猎犬近战（巴托腾 / 莱斯腾 / 阿卡腾）按需求方确认归近战', () => {
    const r = resolveFromExport({ productCategory: 'SentinelWeapons', compatibilityTags: ['HOUND_WEAPON'] });
    assert.equal(r.broad, 'melee');
    assert.equal(r.unresolved, false);
  });

  // 需求方 2026-11-08：「Pistol 说明就是手枪啊」
  it('无 holster 的激光点发系列按名字归手枪类', () => {
    for (const id of ['BurstLaserPistol', 'PrismaBurstLaserPistol', 'PrimeBurstLaserPistol']) {
      const r = resolveFromExport({
        uniqueName: `/Lotus/Weapons/Sentients/SentBurstLaser/${id}`,
        productCategory: 'SentinelWeapons',
        compatibilityTags: ['SENTINEL_WEAPON'],
      });
      assert.equal(r.broad, 'pistol', id);
      assert.equal(r.unresolved, false, id);
    }
  });

  // 需求方 2026-11-08：「Garuda Talons 是 garuda 被动带的近战武器，算近战」
  it('伽拉之爪按架势标签归近战爪类', () => {
    const r = resolveFromExport({
      productCategory: 'SpecialItems',
      holsterCategory: 'FIST',
      compatibilityTags: ['CLAWS_STANCE_STANCE'],
    });
    assert.equal(r.broad, 'melee');
    assert.deepEqual(r.specific, ['claws']);
    assert.equal(r.unresolved, false);
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

describe('弓 vs 弩（需求方 2026-07-11：弩不能装弓箭类 Mod / 弓箭·赋能）', () => {
  const bowSlots = { broad: 'bow' as const, specific: [], source: 'holster' as const, basis: { tags: [] }, unresolved: false };

  it('真正的弓可以装弓箭类', () => {
    assert.deepEqual(compatibleModKinds(bowSlots, true).sort(), ['bow', 'primary', 'rifle']);
    assert.equal(canEquipMod(bowSlots, 'bow', true), true);
  });

  it('弩只吃步枪类 + 主武器类，不吃弓箭类', () => {
    assert.deepEqual(compatibleModKinds(bowSlots, false).sort(), ['primary', 'rifle']);
    assert.equal(canEquipMod(bowSlots, 'bow', false), false);
    assert.equal(canEquipMod(bowSlots, 'rifle', false), true);
  });

  it('携带方式 BOW 的才是真弓；弩的英文名/标签对得上但携带方式是 LongGuns', () => {
    assert.equal(isTrueBow({ name: 'Dread', holsterCategory: 'BOW', productCategory: 'LongGuns' }), true);
    assert.equal(isTrueBow({ name: 'Zhuge', holsterCategory: 'WIDE_RIFLE', productCategory: 'LongGuns' }), false);
  });

  it('细类判定：托里德算发射器；诸葛连弩/阿提卡/噬蛇弩算弩；螺钉手枪不能因为资源路径含 CrossBow 就算弩', () => {
    assert.equal(exportSubclass({ name: 'Torid', uniqueName: '/Lotus/Weapons/.../BioWeapon', holsterCategory: 'RIFLE' }), 'launcher');
    assert.equal(exportSubclass({ name: 'Zhuge', uniqueName: '/Lotus/.../RepeatingCrossbow', holsterCategory: 'WIDE_RIFLE' }), 'crossbow');
    assert.equal(
      exportSubclass({ name: 'Attica', uniqueName: '/Lotus/.../TnoPrmryXbowWeapon', holsterCategory: 'WIDE_RIFLE', compatibilityTags: ['PROJECTILE', 'CROSSBOW'] }),
      'crossbow',
    );
    assert.equal(
      exportSubclass({ name: 'Nagantaka', uniqueName: '/Lotus/.../GarudaCrossbow', holsterCategory: 'WIDE_RIFLE', compatibilityTags: ['CROSSBOW'] }),
      'crossbow',
    );
    assert.equal(exportSubclass({ name: 'Bolto', uniqueName: '/Lotus/Weapons/Tenno/Pistol/CrossBow', productCategory: 'Pistols' }), null);
    assert.equal(exportSubclass({ name: 'Dread', holsterCategory: 'BOW', productCategory: 'LongGuns', compatibilityTags: ['BOW'] }), null);
    // 赤毒·布拉玛：携带方式 BOW 的真弓，名字里的 Bramma 要算发射器
    assert.equal(
      exportSubclass({ name: 'Kuva Bramma', uniqueName: '/Lotus/.../GrnBowWeapon', holsterCategory: 'BOW', productCategory: 'LongGuns', compatibilityTags: ['BOW'] }),
      'launcher',
    );
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

/**
 * D-152（需求方 2026-11-13）：「全改成 WFCD 为主，除非有他确认不了的」。
 *
 * 槽位判定以前 100% 用官方导出的 `holsterCategory`，而官方导出比 WFCD 慢：
 * 官方没有的武器落到兜底 `rifle`，双持 / 投掷副手又被携行方式（WIDE_RIFLE / SMG）
 * 翻成步枪 —— 新武器吃错 Mod、次要武器里冒出一堆「步枪」。
 */
describe('WFCD 为主的槽位判定（D-152）', () => {
  it('WFCD 的标准类型都能映射：弓 / 霰弹 / 狙击 / 手枪 / 双手枪 / 投掷', () => {
    const cases: Array<[string, string]> = [
      ['Bow', 'bow'],
      ['Shotgun', 'shotgun'],
      ['Sniper', 'sniper'],
      ['Rifle', 'rifle'],
      ['Pistol', 'pistol'],
      ['Dual Pistols', 'pistol'],
      ['Throwing', 'pistol'],
      ['Melee', 'melee'],
      ['Launcher', 'rifle'],
    ];
    for (const [type, want] of cases) {
      const r = resolveFromWfcd({ id: 'x', type, productCategory: 'LongGuns' });
      assert.equal(r?.broad, want, `${type} 应判成 ${want}`);
      assert.equal(r?.source, 'wfcd-type');
    }
  });

  it('WFCD 把近战的 type 错标成 Rifle 时，以「文件 / productCategory 说是近战」为准', () => {
    // 实测这 10 把在 WFCD 里 type=Rifle，但文件是 Melee.json、productCategory=Melee
    for (const name of ['Mk1-Bo', 'Mk1-Furax', 'Paracesis', 'Prisma Skana', 'Dual Viciss']) {
      const r = resolveFromWfcd({ id: name, type: 'Rifle', productCategory: 'Melee', file: 'Melee' });
      assert.equal(r?.broad, 'melee', `${name} 不能因为 type=Rifle 就变成步枪`);
    }
  });

  it('空战按文件 / 大类判，不看 type', () => {
    assert.equal(resolveFromWfcd({ id: 'x', type: 'Rifle', productCategory: 'SpaceGuns', file: 'Arch-Gun' })?.broad, 'archgun');
    assert.equal(resolveFromWfcd({ id: 'x', type: 'Melee', productCategory: 'SpaceMelee', file: 'Arch-Melee' })?.broad, 'archmelee');
  });

  it('判不出来的返回 null，交给官方导出兜底（显赫武器等）', () => {
    assert.equal(resolveFromWfcd({ id: 'x', type: 'Zaw Component' }), null);
    assert.equal(resolveFromWfcd({ id: 'x' }), null);
  });

  it('新武器（霜冥差 / 寒怨刺 / 石晶之花 Prime / 闪劫 Prime）判定正确', () => {
    const num = resolveFromWfcd({ id: 'DuelistBow', type: 'Bow', productCategory: 'LongGuns', file: 'Primary' });
    assert.equal(num?.broad, 'bow');
    // 弓是步枪大类下的，有额外专属：弓类 + 步枪类 + 主武器类
    assert.deepEqual(compatibleModKinds({ ...num!, specific: [], unresolved: false }, true).sort(), ['bow', 'primary', 'rifle']);

    const aks = resolveFromWfcd({ id: 'DuelistPistols', type: 'Dual Pistols', productCategory: 'Pistols', file: 'Secondary' });
    assert.equal(aks?.broad, 'pistol');
    assert.deepEqual(compatibleModKinds({ ...aks!, specific: [], unresolved: false }), ['pistol']);

    const stef = resolveFromWfcd({ id: 'PrimeSteflosShotgun', type: 'Shotgun', productCategory: 'LongGuns', file: 'Primary' });
    assert.deepEqual(compatibleModKinds({ ...stef!, specific: [], unresolved: false }).sort(), ['primary', 'shotgun']);

    const cor = resolveFromWfcd({ id: 'PrimeCorufellScytheWeapon', type: 'Melee', productCategory: 'Melee', file: 'Melee' });
    assert.equal(cor?.broad, 'melee');
  });

  it('投掷副手按手枪类 Mod 算（副手 Mod 通用）', () => {
    const r = resolveFromWfcd({ id: 'Kunai', type: 'Throwing', productCategory: 'Pistols', file: 'Secondary' });
    assert.deepEqual(compatibleModKinds({ ...r!, specific: [], unresolved: false }), ['pistol']);
  });

  it('弓和狙击保留自己的专属类，同时也吃步枪类（需求方：都是步枪大类下的）', () => {
    const bow = resolveFromWfcd({ id: 'x', type: 'Bow', productCategory: 'LongGuns' })!;
    const sniper = resolveFromWfcd({ id: 'x', type: 'Sniper', productCategory: 'LongGuns' })!;
    assert.ok(compatibleModKinds({ ...bow, specific: [], unresolved: false }, true).includes('bow'));
    assert.ok(compatibleModKinds({ ...bow, specific: [], unresolved: false }, true).includes('rifle'));
    assert.ok(compatibleModKinds({ ...sniper, specific: [], unresolved: false }).includes('sniper'));
    assert.ok(compatibleModKinds({ ...sniper, specific: [], unresolved: false }).includes('rifle'));
  });
});

/**
 * D-152：**双手枪 ≠ 双刀 / 双剑**（需求方 2026-11-13：「你注意区分双手枪跟双刀就行」）。
 *
 * 近战双持武器的 id 也带 `Dual` 前缀（`DualHeatSwords` 烈焰双剑 / `DualKamas` 双短柄战镰…），
 * 官方 `DUAL_*` 标签更是全挂在近战上。如果只按 id 前缀判，「双枪·滑射」赋能会出现在双刀上。
 */
describe('双手枪与双刀必须分开（D-152）', () => {
  it('近战带 Dual 前缀也不算是双手枪', () => {
    for (const id of ['DualHeatSwords', 'DualKamas', 'DualCleaverWeapon', 'DualShortSword', 'DualEtherSword']) {
      assert.equal(isDualPistolByWfcd('Melee', id, 'melee'), false, `${id} 是近战，不该算双手枪`);
    }
  });

  it('真双手枪算双手枪', () => {
    for (const id of ['AkLexPistols', 'AkimboBolto', 'PrimeAkBoltoWeapon', 'DualMagnus', 'TennoUzi']) {
      assert.equal(isDualPistolByWfcd('Pistol', id, 'pistol'), true, `${id} 是双手枪`);
    }
  });

  it('WFCD 只说 Dual Pistols 但宽类是近战时，仍不算（宽类优先）', () => {
    assert.equal(isDualPistolByWfcd('Dual Pistols', 'DualKamas', 'melee'), false);
  });

  it('单持手枪不算', () => {
    assert.equal(isDualPistolByWfcd('Pistol', 'HeavyPistol', 'pistol'), false, '雷克斯是单持');
    assert.equal(isDualPistolByWfcd('Pistol', 'KuvaNukor', 'pistol'), false);
  });
});
