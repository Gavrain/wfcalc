import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  renderTemplate,
  collectValues,
  parseNumber,
  parseMultiplier,
  classifyArcane,
  cleanArcane,
  categoryOf,
  WEAPON_PREFIXES,
} from '../src/mods/clean-arcanes.ts';
import { cleanModSets, SET_EFFECTS } from '../src/mods/clean-modsets.ts';

describe('赋能模板渲染', () => {
  const dict = {
    '/D': '击杀时：|BONUS| 伤害',
    '/B': '+|val|%',
  };

  it('把 sub 的数值填进 |占位符|，且不会出现 ++', () => {
    const tpl = { tag: '/D', sub: { BONUS: { tag: '/B', sub: { val: '+30' } } } };
    const out = renderTemplate(tpl, dict).replace(/\s+/g, ' ');
    assert.equal(out, '击杀时：+30% 伤害');
  });

  it('套装那种扁平结构也能渲染', () => {
    assert.match(renderTemplate({ STAT1: '5' }, {}), /STAT1=5/);
  });

  it('字符串 sub 若是语言键则查表', () => {
    const d = { '/X': '|val| 点', '/L': '语言文本' };
    const tpl = { tag: '/X', sub: { val: '/L' } };
    assert.equal(renderTemplate(tpl, d), '语言文本 点');
  });

  it('递归收集数值槽，保留路径', () => {
    const lv = [{ tag: '/D', sub: { BONUS: { tag: '/B', sub: { val: '+30' } }, DURATION: '6' } }];
    const v = collectValues(lv);
    assert.equal(v['[0].BONUS.val'], 30);
    assert.equal(v['[0].DURATION'], 6);
  });

  it('数值解析：带正负号与百分号', () => {
    assert.equal(parseNumber('+30'), 30);
    assert.equal(parseNumber('-5.5'), -5.5);
    assert.equal(parseNumber('2.5%'), 2.5);
    assert.equal(parseNumber('abc'), null);
  });

  it('乘法型 x8 单独解析，不会被当成百分比', () => {
    assert.equal(parseMultiplier('x8'), 8);
    assert.equal(parseMultiplier('x2.5'), 2.5);
    assert.equal(parseNumber('x8'), null);
    const v = collectValues([{ tag: '/D', sub: { val: 'x8' } }]);
    assert.equal(v['[0].val#x'], 8);
    assert.equal(v['[0].val'], undefined);
  });
});

describe('赋能分类', () => {
  it('多重 → multishot 乘区', () => {
    const r = classifyArcane('霰弹·仇杀', '击杀时：+180% 多重射击');
    assert.equal(r.kind, 'multishot');
    assert.equal(r.bucket, 'multishot');
  });

  it('暴击几率与暴击伤害分开归类', () => {
    assert.equal(classifyArcane('主要·毒侵', '触发时：+3.6% 暴击伤害').bucket, 'critMultiplier');
    assert.equal(classifyArcane('瀑流·溢能', '过载护盾激活时：+300% 暴击几率').bucket, 'critChance');
  });

  it('附加元素 → elemental 乘区', () => {
    const r = classifyArcane('近战·暴露', '使用技能后：近战攻击获得 60% 腐蚀伤害，持续 25 秒');
    assert.equal(r.kind, 'elemental');
    assert.equal(r.bucket, 'elemental');
  });

  it('产生投射物/冲击波 → special，不当成伤害% 加成', () => {
    assert.equal(classifyArcane('神威·触染', '旋身飞跃后：飞身瞄准时进行近战会射出一个投射物，并在撞击后爆炸').kind, 'special');
  });

  it('乘法型伤害不当作百分比加', () => {
    const r = classifyArcane('近战·疾驰', '对被冰冻的敌人造成近战伤害 x2.50');
    assert.equal(r.kind, 'damageBuff');
    assert.equal(r.bucket, null);
    assert.match(r.reason, /乘法型/);
  });

  it('只加护甲的赋能被排除（近战·坚壁）', () => {
    const r = classifyArcane('近战·坚壁', '近战击杀时：+210 护甲，持续 10 秒。', 'ArmorOnMeleeKill');
    assert.equal(r.kind, 'nonDamage');
  });

  it('近战·苦痛是复制异常状态，不是护甲，必须收录', () => {
    const r = classifyArcane('近战·苦痛', '受到异常状态影响的敌人在被近战攻击击倒时，增加 6 层额外异常状态层数。', 'DuplicateStatusOnKnock');
    assert.notEqual(r.kind, 'nonDamage');
  });

  it('前缀分类：三个类别', () => {
    assert.equal(categoryOf('主要·'), 'primary');
    assert.equal(categoryOf('次要·'), 'secondary');
    assert.equal(categoryOf('瀑流·'), 'secondary');
    assert.equal(categoryOf('近战·'), 'melee');
    assert.equal(categoryOf('神威·'), 'melee');
    assert.equal(categoryOf('和平·'), 'kitgun');
  });

  it('战甲赋能（赋能·前缀）不在收录范围', () => {
    const res = cleanArcane('/X/ArcaneReaper', { name: '/N', levelStats: [{}] }, { '/N': '赋能·收割' }, { '/N': 'Arcane Reaper' });
    assert.ok('excluded' in res);
    assert.equal(res.excluded, 'outOfScope');
  });

  it('收录范围内、有数值的赋能能产出逐级数据', () => {
    const raw = {
      name: '/N',
      rarity: 'RARE',
      levelStats: [
        [{ tag: '/D', sub: { BONUS: { tag: '/B', sub: { val: '+5' } } } }],
        [{ tag: '/D', sub: { BONUS: { tag: '/B', sub: { val: '+30' } } } }],
      ],
    };
    const dict = { '/N': '主要·无情', '/D': '击杀时：|BONUS| 伤害', '/B': '+|val|%' };
    const res = cleanArcane('/Lotus/Arcanes/PrimaryDamageOnKill', raw, dict, { '/N': 'Primary Merciless' });
    assert.ok(!('excluded' in res));
    assert.equal(res.maxRank, 1);
    assert.equal(res.category, 'primary');
    assert.equal(res.effectKind, 'damageBuff');
    assert.equal(res.levels[1]!.values['[0].BONUS.val'], 30);
  });

  it('收录前缀覆盖用户确认的 12 类', () => {
    for (const p of ['主要·', '次要·', '近战·', '神威·', '和平·', '残差·', '弓箭·', '霰弹·', '双枪·', '瀑流·', '联结·', '分形·']) {
      assert.ok(WEAPON_PREFIXES.includes(p as (typeof WEAPON_PREFIXES)[number]), `${p} 应被收录`);
    }
  });
});

describe('套装乘区归属', () => {
  it('私法的暴击强化按"固定加算的绝对值暴击率"处理', () => {
    const v = SET_EFFECTS['Vigilante']!;
    assert.equal(v.kind, 'critChanceFlat');
    assert.equal(v.bucket, 'critChance');
    assert.match(v.note, /固定加算/);
  });

  it('角斗士是每层连击加暴率，同样进暴率乘区', () => {
    const g = SET_EFFECTS['Gladiator']!;
    assert.equal(g.kind, 'critChancePerCombo');
    assert.equal(g.bucket, 'critChance');
  });

  it('牺牲套装是增强本套 Mod，结算不进新乘区', () => {
    const s = SET_EFFECTS['Sacrifice']!;
    assert.equal(s.kind, 'enhanceOwnMods');
    assert.equal(s.bucket, null);
  });

  it('只影响同伴/生存的套装不进伤害汇总', () => {
    for (const k of ['Hunter', 'Augur', 'Boreal', 'Spider']) {
      assert.equal(SET_EFFECTS[k]!.bucket, null, `${k} 不应进伤害乘区`);
    }
  });

  it('清洗后逐级数值按"已装件数"索引', () => {
    const raw = {
      '/Lotus/Upgrades/Mods/Sets/Vigilante/VigilanteSetMod': {
        description: '/D',
        numUpgradesInSet: 6,
        levelStats: [{ STAT1: '5' }, { STAT1: '10' }, { STAT1: '30' }],
      },
    };
    const sets = cleanModSets(raw, { '/D': '|STAT1|% 几率强化暴击' }, { '/D': '|STAT1|% chance' }, new Map([['Vigilante', ['vigilante_fervor']]]));
    assert.equal(sets.length, 1);
    const s = sets[0]!;
    assert.equal(s.name.zh, '私法');
    assert.equal(s.levels.length, 3);
    assert.equal(s.levels[0]!.values['STAT1'], 5);
    assert.equal(s.levels[2]!.values['STAT1'], 30);
    assert.match(s.description.zh, /5%|30%/);
    assert.deepEqual(s.memberMods, ['vigilante_fervor']);
  });

  it('没有乘区标注的套装被跳过（宁缺勿错）', () => {
    const raw = { '/X/UnknownSetMod': { description: '/D', levelStats: [{ A: '1' }] } };
    const sets = cleanModSets(raw, {}, {}, new Map());
    assert.equal(sets.length, 0);
  });
});
