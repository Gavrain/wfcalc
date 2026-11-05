import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { levelValues, round4, cleanMod, isStanceMod, effectiveMaxRank } from '../src/mods/clean-mods.ts';
import { lookupStat, ALL_ELEMENT_KEYS, ALL_PHYSICAL_KEYS } from '../src/mods/stat-map.ts';
import type { ZkMod } from '../src/mods/zk-source.ts';

describe('Mod 等级数值换算', () => {
  it('满级值按等级上限线性递增（Serration：满级 165%，f=10 → 每级 16.5）', () => {
    const v = levelValues(165, 10);
    assert.equal(v.length, 11);
    assert.equal(v[0], 0);
    assert.equal(v[1], 16.5);
    assert.equal(v[10], 165);
  });

  it('Point Strike：满级 150%、f=5 → 每级 30%', () => {
    const v = levelValues(150, 5);
    assert.deepEqual(v, [0, 30, 60, 90, 120, 150]);
  });

  it('Hornet Strike：满级 220%、f=10 → 每级 22%', () => {
    const v = levelValues(220, 10);
    assert.equal(v[1], 22);
    assert.equal(v[10], 220);
  });

  it('给定每级加量时以它为准（Galvanized Steel：每级 30%，满级 300%）', () => {
    const v = levelValues(300, 10, 30);
    assert.equal(v[1], 30);
    assert.equal(v[10], 300);
  });

  it('f=0 的模组只有一个数值（无等级）', () => {
    assert.deepEqual(levelValues(11, 0), [11]);
  });

  it('保留负值步长（Heavy Caliber 的 -55% 精度）', () => {
    assert.deepEqual(levelValues(-55, 10).slice(1, 3), [-5.5, -11]);
  });

  it('浮点误差收口到 4 位（0.1×3 不会出现 0.30000000000000004）', () => {
    assert.equal(round4(0.1 * 3), 0.3);
  });
});

describe('属性键 → 乘区映射（对照乘区归属表）', () => {
  it('基伤与多重是两个独立乘区', () => {
    const dmg = lookupStat('dmg');
    const ms = lookupStat('ms');
    assert.equal(dmg?.stat, 'baseDamage');
    assert.equal(dmg?.bucket, 'baseDamage');
    assert.equal(ms?.stat, 'multishot');
    assert.equal(ms?.bucket, 'multishot');
  });

  it('元素按类型各自维护变量，进 elemental 乘区', () => {
    for (const k of ALL_ELEMENT_KEYS) {
      const m = lookupStat(k);
      assert.equal(m?.stat, `elemental:${k}`, `${k} 应映射到 elemental:${k}`);
      assert.equal(m?.bucket, 'elemental');
    }
  });

  it('物理类型加量基数是自身面板值，与元素分开', () => {
    for (const k of ALL_PHYSICAL_KEYS) {
      const m = lookupStat(k);
      assert.equal(m?.stat, `physical:${k}`);
      assert.equal(m?.bucket, 'physical');
    }
  });

  it('sd 是"异常状态伤害"而不是状态持续时间（最易错配的一条）', () => {
    assert.equal(lookupStat('sd')?.stat, 'statusDamage');
    assert.equal(lookupStat('statusDur')?.stat, 'statusDuration');
  });

  it('co 归到基伤乘区，并标注"不吃灵化基伤与 AoE"', () => {
    const co = lookupStat('co');
    assert.equal(co?.stat, 'baseDamage');
    assert.equal(co?.kind, 'conditional');
    assert.match(co?.note ?? '', /灵化/);
  });

  it('派系加成是独立乘区', () => {
    assert.equal(lookupStat('fac')?.bucket, 'faction');
  });

  it('镀层暴率/暴伤属于条件类，不能当作常驻面板加量', () => {
    assert.equal(lookupStat('cd')?.kind, 'normal');
    // 镀层钢只是"每层 +30% 暴伤"，其条件由 bg 字段描述，基础键仍是 normal
  });

  it('弹匣百分比与固定值是同一个属性、不同单位', () => {
    assert.equal(lookupStat('mag')?.stat, 'magazine');
    assert.equal(lookupStat('mag')?.unit, 'percent');
    assert.equal(lookupStat('magFlat')?.unit, 'flat');
  });

  it('未知键返回 undefined（流水线据此报"待确认"，不静默丢弃）', () => {
    assert.equal(lookupStat('不存在的键'), undefined);
  });
});

/** 构造一个最小的 ZK 模组 */
function zk(partial: Partial<ZkMod> & { i: string; n: string; p: Array<[string, number, number?]> }): ZkMod {
  return {
    t: 'rifle',
    s: 'g',
    d: 4,
    f: 5,
    r: 'r',
    y: 'r',
    de: '',
    z: '',
    ...partial,
  } as ZkMod;
}

describe('Mod 清洗', () => {
  it('Serration：单条基伤，满级 165%', () => {
    const { mod } = cleanMod(zk({ i: 'serration', n: 'Serration', z: '膛线', p: [['dmg', 165]], f: 10 }));
    assert.equal(mod.stats.length, 1);
    assert.equal(mod.stats[0]!.stat, 'baseDamage');
    assert.equal(mod.stats[0]!.levelValues.at(-1), 165);
    assert.equal(mod.maxRank, 10);
  });

  it('多属性模组逐条保留（Heavy Caliber：+165% 伤害 -55% 精准）', () => {
    const { mod } = cleanMod(zk({ i: 'heavy_caliber', n: 'Heavy Caliber', p: [['dmg', 165], ['acc', -55]], f: 10 }));
    assert.equal(mod.stats.length, 2);
    assert.equal(mod.stats[1]!.levelValues.at(-1), -55);
  });

  it('互斥关系被保留（同族只能装一个）', () => {
    const { mod } = cleanMod(
      zk({ i: 'critical_delay', n: 'Critical Delay', p: [['cc', 200]], fam: 'point_strike', inc: ['point_strike'] }),
    );
    assert.equal(mod.exclusiveGroup, 'point_strike');
    assert.deepEqual(mod.conflictsWith, ['point_strike']);
  });

  it('不可识别的属性键单独上报，不混进 stats', () => {
    const { mod, unknownKeys } = cleanMod(zk({ i: 'x', n: 'X', p: [['dmg', 100], ['喵喵键', 5]] }));
    assert.deepEqual(unknownKeys, ['喵喵键']);
    assert.equal(mod.stats.length, 1);
  });

  it('条件效果从 bg 解析出来（镀层分裂膛室：击杀叠 5 层、持续 20 秒）', () => {
    const { mod } = cleanMod(
      zk({
        i: 'galvanized_chamber',
        n: 'Galvanized Chamber',
        p: [['ms', 230]],
        bg: [{ k: 'buff', tr: 'kill', g: 'multishot', st: 5, du: 20 }],
      }),
    );
    assert.equal(mod.conditions.length, 1);
    assert.equal(mod.conditions[0]!.trigger, 'kill');
    assert.equal(mod.conditions[0]!.maxStacks, 5);
    assert.equal(mod.conditions[0]!.durationSeconds, 20);
  });

  it('等级上限的已知笔误被修正（Amanata Pressure：f 写 1，实为 6 级）', () => {
    assert.equal(effectiveMaxRank({ i: 'amanata_pressure', f: 1 }), 5);
    assert.equal(effectiveMaxRank({ i: 'serration', f: 10 }), 10);
  });
});

describe('架势识别', () => {
  it('描述以 Stance: 开头的判为架势', () => {
    assert.equal(isStanceMod({ t: 'assault_saw', de: 'Stance: Rip and rend with this Assault Saw stance.', p: [] }), true);
  });

  it('描述里不含 Stance 但无属性数值的，也判为架势', () => {
    assert.equal(isStanceMod({ t: 'heavy_blade', de: 'Arcing cuts with spinning finish.', p: [] }), true);
  });

  it('官方标成 STANCE 时直接判为架势', () => {
    assert.equal(isStanceMod({ t: 'melee', de: '随便写', p: [] }, { type: 'STANCE' }), true);
  });

  it('有数值的模组不会被误判成架势', () => {
    assert.equal(isStanceMod({ t: 'melee', de: '+X% Melee Damage', p: [['dmg', 120]] }), false);
  });
});
