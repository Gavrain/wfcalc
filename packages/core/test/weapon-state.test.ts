/**
 * 重构不变量：`state.computed` 必须与结算链各自算出的值**逐位相等**。
 *
 * 这是 D-075 的安全网：重构只是把"已经算对的东西"组织成状态树，
 * 任何一处 computed 与结算链不一致，都说明组织过程中引入了新逻辑。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compute } from '../src/main.ts';
import type { Contribution } from '../src/contributions.ts';
import type { Weapon } from '../src/weapon.ts';
import { modeWithSegments } from './_helpers.ts';

const near = (a: number, b: number, eps = 1e-9, msg = '') =>
  assert.ok(Math.abs(a - b) < eps, `${msg} ${a} != ${b}`);

const pct = (stat: Contribution['stat'], amount: number, source: string): Contribution =>
  ({ stat, form: 'pct', amount, source });

function makeWeapon(ms: number): Weapon {
  return {
    id: 'W',
    name: 'W',
    category: 'primary',
    critChance: 0.23,
    critMultiplier: 2.1,
    statusChance: 0.31,
    fireRate: 11.6667,
    magazineSize: 70,
    reloadTime: 1.7,
    modes: [
      modeWithSegments(
        { id: 'primary', role: 'normal', trigger: 'auto', bullets: 1, multishot: ms },
        [{
          kind: 'impact',
          aoe: false,
          procChance: 0.31,
          damage: { impact: 7.13, puncture: 6.21, slash: 9.66 },
        }],
      ),
    ],
  };
}

const BUILDS: { label: string; contribs: Contribution[]; kuva?: { type: 'heat'; ratio: number } }[] = [
  { label: '空配装', contribs: [] },
  {
    label: '膛线+分裂膛室+致命一击+弱点感应+地狱火',
    contribs: [
      pct('baseDamage', 165, 'serration'),
      pct('multishot', 90, 'split_chamber'),
      pct('critChance', 150, 'point_strike'),
      pct('critMultiplier', 120, 'vital_sense'),
      pct('elemental:heat', 90, 'hellfire'),
    ],
  },
  {
    label: '同上 + 玄骸火 60%',
    contribs: [
      pct('baseDamage', 165, 'serration'),
      pct('multishot', 90, 'split_chamber'),
      pct('critChance', 150, 'point_strike'),
      pct('critMultiplier', 120, 'vital_sense'),
      pct('elemental:heat', 90, 'hellfire'),
    ],
    kuva: { type: 'heat', ratio: 0.6 },
  },
  {
    label: '多元素：地狱火 + 冰寒弹头（火+冰 → 爆炸）',
    contribs: [
      pct('elemental:heat', 90, 'hellfire'),
      pct('elemental:cold', 90, 'cryo_rounds'),
      pct('baseDamage', 165, 'serration'),
    ],
  },
];

describe('WeaponState 与结算链一致（D-075 安全网）', () => {
  for (const ms of [1, 15]) {
    for (const build of BUILDS) {
      it(`面板多重 ${ms} · ${build.label}`, () => {
        const w = makeWeapon(ms);
        const res = compute(w, w.modes[0]!, build.contribs, {
          behead: undefined,
          kuva: build.kuva,
          headshot: { enabled: false, multiplier: 3 },
        } as never, false);
        const st = res.state;
        const c = st.computed;

        // 1) computed 的新面板 = 结算链里的 panelWithKuva
        const seg = res.segments[0]!;
        for (const [t, v] of Object.entries(seg.panelWithKuva)) {
          near(c.新面板[t as keyof typeof c.新面板] ?? 0, v as number, 1e-9, `新面板.${t}`);
        }
        near(
          c.新面板总伤,
          Object.values(seg.panelWithKuva).reduce<number>((a, b) => a + (b ?? 0), 0),
          1e-9,
          '新面板总伤',
        );

        // 2) computed 的基伤面板 = 结算链里的 baseAfterBaseDamage
        for (const [t, v] of Object.entries(seg.baseAfterBaseDamage)) {
          near(c.基伤面板[t as keyof typeof c.基伤面板] ?? 0, v as number, 1e-9, `基伤面板.${t}`);
        }

        // 3) computed 的命中分布 = 结算链的 finalHit
        for (const [t, v] of Object.entries(seg.finalHit)) {
          near(c.命中分布[t as keyof typeof c.命中分布] ?? 0, v as number, 1e-9, `命中分布.${t}`);
        }

        // 4) 暴击乘区读 computed，与 segment 结果一致
        near(c.当前暴击率, seg.critChance, 1e-12, '当前暴击率');
        near(c.当前暴击伤害, seg.critDamage, 1e-12, '当前暴击伤害');

        // 5) 多重：面板多重 × (1+Σ%)，与 output 一致
        near(c.当前多重, ms * (1 + build.contribs.filter((x) => x.stat === 'multishot').reduce((a, x) => a + x.amount / 100, 0)), 1e-12, '当前多重');
        near(c.当前多重, res.output.multishot, 1e-12, '当前多重 vs output');

        // 6) panelPairs 现在读 computed，必须与 computed 自洽
        near(res.panelPairs.critChance.after, c.当前暴击率, 1e-12);
        near(res.panelPairs.multishot.after, c.当前多重, 1e-12);
        near(res.panelPairs.reloadTime.after, c.当前装填时间, 1e-12);

        // 7) 单次射击 = 单弹头 × 当前多重
        near(res.output.perShot, seg.line.average * c.当前多重, 1e-9, '单次射击');
      });
    }
  }
});

describe('多段武器：每段各有 computed（D-075 补齐）', () => {  /** Astilla Prime 那种 4 段结构：impact / attack / explosiveAttack / embedDeathAttack */
  function multiSegmentWeapon(): Weapon {
    return {
      id: 'MultiSeg',
      name: 'Multi Seg',
      category: 'primary',
      critChance: 0.15,
      critMultiplier: 2,
      statusChance: 0.2,
      fireRate: 5,
      magazineSize: 10,
      reloadTime: 1.5,
      modes: [
        modeWithSegments(
          { id: 'primary', role: 'normal', trigger: 'semi', bullets: 1, multishot: 1 },
          [
            { kind: 'impact', aoe: false, procChance: 0.2, damage: { impact: 3 } },
            { kind: 'attack', aoe: false, procChance: 0.2, damage: { puncture: 100 } },
            { kind: 'explosiveAttack', aoe: true, procChance: 0.2, damage: { blast: 140 } },
          ],
        ),
      ],
    };
  }

  it('perSegment 数量 = 段数，且每段 computed 与该段 finalHit 一致', () => {
    const w = multiSegmentWeapon();
    const res = compute(w, w.modes[0]!, [], { headshot: { enabled: false, multiplier: 3 } } as never, false);
    assert.equal(res.perSegment.length, res.segments.length);
    for (const [i, s] of res.segments.entries()) {
      const total = Object.values(s.finalHit).reduce<number>((a, b) => a + (b ?? 0), 0);
      near(res.perSegment[i]!.computed.命中分布总伤, total, 1e-9, `段${i}`);
    }
  });

  it('每段的 新面板 / 基伤面板 与 segments 里的对应字段一致', () => {
    const w = multiSegmentWeapon();
    const res = compute(w, w.modes[0]!, [pct('baseDamage', 165, 'serration')], {
      headshot: { enabled: false, multiplier: 3 },
    } as never, false);
    for (const [i, s] of res.segments.entries()) {
      const seg = res.perSegment[i]!.computed;
      for (const [t, v] of Object.entries(s.panelWithKuva)) {
        near(seg.新面板[t as keyof typeof seg.新面板] ?? 0, v as number, 1e-9, `段${i}.新面板.${t}`);
      }
      for (const [t, v] of Object.entries(s.baseAfterBaseDamage)) {
        near(seg.基伤面板[t as keyof typeof seg.基伤面板] ?? 0, v as number, 1e-9, `段${i}.基伤面板.${t}`);
      }
    }
  });

  it('state 取主段；perSegment[0] 与主段一致', () => {
    const w = multiSegmentWeapon();
    const res = compute(w, w.modes[0]!, [], { headshot: { enabled: false, multiplier: 3 } } as never, false);
    near(res.state.computed.命中分布总伤, res.perSegment[0]!.computed.命中分布总伤, 1e-12);
  });

  it('所有段合计 = totalSpread（state 只覆盖主段，合计要看 totalSpread）', () => {
    const w = multiSegmentWeapon();
    const res = compute(w, w.modes[0]!, [], { headshot: { enabled: false, multiplier: 3 } } as never, false);
    const sum = res.perSegment.reduce((a, s) => a + s.computed.命中分布总伤, 0);
    near(sum, res.moddedPanelTotal, 1e-9, '多段合计');
  });
});

describe('镀层类（co）进 state 的基伤面板（D-024 回归）', () => {
  it('co 加量 = x% × a × y，必须出现在 state.computed.基伤面板', () => {
    const w = makeWeapon(1);
    // 步枪才能 +40%/层，y=2，a=3 → +240%
    const contribs = [pct('co', 40, 'galvanized_aptitude'), pct('baseDamage', 165, 'serration')];
    const res = compute(w, w.modes[0]!, contribs, { coStacks: 2, coStatusTypes: 3 } as never, false);
    const factor = 1 + 1.65 + 0.4 * 3 * 2; // = 2.65 + 2.4 = 5.05
    const panelTotal = 7.13 + 6.21 + 9.66; // 23
    near(res.state.computed.基伤面板总伤, panelTotal * factor, 1e-9, '基伤面板总伤');
    // 与结算链一致
    const seg = res.segments[0]!;
    near(
      res.state.computed.基伤面板总伤,
      Object.values(seg.baseAfterBaseDamage).reduce<number>((a, b) => a + (b ?? 0), 0),
      1e-9,
      '与 baseAfterBaseDamage 一致',
    );
  });

  it('a=0 时 co 不生效', () => {
    const w = makeWeapon(1);
    const contribs = [pct('co', 40, 'galvanized_aptitude')];
    const res = compute(w, w.modes[0]!, contribs, { coStacks: 2, coStatusTypes: 0 } as never, false);
    near(res.state.computed.基伤面板总伤, 23, 1e-9);
  });
});
