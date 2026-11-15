/**
 * 武器级被动「+N 基础伤害（固定值）」——以托里德灵化被动 +51 为例。
 *
 * 需求方 2026-11-14 逐条确认的口径：
 * > 「他灵化面板是 51，这个被动是再加 51」
 * > 「灵化武器的被动是对所有攻击段生效的。意味着他的榴弹撞击和毒云也有这个加成」
 * > 「要按'原始面板分布'平摊，但每段的面板分布不同」
 * > 「不能吃镀层，同时因为冷颤属于类镀层，所以也不吃。另外范围伤害也是这两者都不吃」
 * > 「dot 基础值应该由各个乘区相乘得到，所以灵化基伤会享受到基伤 mod 加成进入 dotbase 而不会享受到镀层」
 * > 「灵化武器的基伤应该就是提供两个值，在调用的时候走各自的基伤乘区」
 *
 * 落地形态（需求方选的甲方案）：
 *   · 被动挂在**武器级** `Weapon.passives`，`compute()` 逐段求值后挂到
 *     `DamageSegment.passiveBaseDamage`；
 *   · 基伤乘区走**两路**：面板基伤 × k_普通 + 被动基伤 × k_被动；
 *   · 数据层这次不动：测试里直接构造 `passives`。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../src/index.ts';

const { compute, passiveBaseDamageOf } = core as any;

const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

/**
 * 托里德的三段（按 `packages/data/src/generated/weapons/primary.json` 的真实数据）。
 *
 * | 段 | 面板 | 说明 |
 * |---|---|---|
 * | 普通·直接命中 | toxin 100 | 榴弹撞击 |
 * | 普通·范围伤害 | toxin 40  | 毒云（AoE） |
 * | 灵化·直接命中 | toxin 51  | 灵化形态本身的面板（**不是**被动） |
 *
 * 被动 +51 是**面板之外再加**的固定值，三段都吃。
 */
function makeTorid(passives?: { kind: string; amount: number }[]) {
  return {
    id: 'BioWeapon', name: 'Torid', nameZh: '托里德',
    critChance: 0.15, critMultiplier: 2, statusChance: 0.23,
    fireRate: 1.5, magazineSize: 5, reloadTime: 1.7,
    ...(passives ? { passives } : {}),
    modes: [
      {
        id: 'primary', role: 'normal', trigger: 'semi', bullets: 1, multishot: 1,
        variants: [
          {
            id: 'direct', label: '直接命中',
            segments: [{ kind: 'attack', aoe: false, damage: { toxin: 100 }, procChance: 0.23 }],
          },
          {
            id: 'blast', label: '范围伤害',
            segments: [{ kind: 'explosiveAttack', aoe: true, damage: { toxin: 40 }, procChance: 0.25 }],
            override: { statusChance: 0.25, fireRate: 1 },
          },
        ],
      },
      {
        id: 'incarnon', role: 'incarnon', trigger: 'semi', bullets: 1, multishot: 1,
        variants: [
          {
            id: 'direct', label: '直接命中', trigger: 'held',
            segments: [{ kind: 'attack', aoe: false, damage: { toxin: 51 }, procChance: 0.39, beam: true }],
            override: { critChance: 0.29, critMultiplier: 3.1, statusChance: 0.39, fireRate: 8 },
          },
        ],
        override: {
          critChance: 0.29, critMultiplier: 3.1, statusChance: 0.39, fireRate: 8,
          magazineSize: 0, reloadTime: 0,
        },
      },
    ],
  };
}

const PASSIVE_51 = [{ kind: 'baseDamageFlat', amount: 51 }];
const OPTS = { beam: false, faction: 'none', coStacks: 0, coStatusTypes: 0 };
const segTotal = (r: any, i: number): number => core.spreadTotal(r.segments[i].finalHit);

describe('被动 +51：按每段自己的面板分布平摊', () => {
  it('纯毒素段：51 全部落在 toxins 上', () => {
    const segs = passiveBaseDamageOf({ toxin: 100 }, PASSIVE_51);
    near(segs.toxin, 51);
  });

  it('多元素段按占比平摊（60 冲击 + 40 切割、+50 → 30 / 20）', () => {
    const segs = passiveBaseDamageOf({ impact: 60, slash: 40 }, [{ kind: 'baseDamageFlat', amount: 50 }]);
    near(segs.impact, 30);
    near(segs.slash, 20);
  });

  it('没有被动时返回 undefined（下游走单路，行为与改动前一致）', () => {
    assert.equal(passiveBaseDamageOf({ toxin: 100 }, undefined), undefined);
    assert.equal(passiveBaseDamageOf({ toxin: 100 }, []), undefined);
    assert.equal(passiveBaseDamageOf({ toxin: 100 }, [{ kind: 'baseDamageFlat', amount: 0 }]), undefined);
  });
});

describe('被动 +51：对所有攻击段生效（托里德）', () => {
  it('三段都吃到 +51 固定值', () => {
    const w = makeTorid(PASSIVE_51);
    const r = compute(w, w.modes[0], [], OPTS);
    // 普通形态有 2 段：直接命中 / 范围伤害
    assert.equal(r.segments.length, 2);
    assert.ok(r.segments[0].passiveBaseDamage, '榴弹撞击应当带被动基伤');
    assert.ok(r.segments[1].passiveBaseDamage, '毒云应当带被动基伤');
    near(r.segments[0].passiveBaseDamage.toxin, 51);
    near(r.segments[1].passiveBaseDamage.toxin, 51);

    // 灵化形态是另一个模式
    const inc = w.modes[1];
    const ri = compute(w, inc, [], OPTS);
    assert.ok(ri.segments[0].passiveBaseDamage, '灵化直接命中应当带被动基伤');
    near(ri.segments[0].passiveBaseDamage.toxin, 51);
  });

  it('没装被动时三段都不带（行为与改动前一致）', () => {
    const w = makeTorid();
    const r = compute(w, w.modes[0], [], OPTS);
    assert.equal(r.segments[0].passiveBaseDamage, undefined);
    assert.equal(r.segments[1].passiveBaseDamage, undefined);
  });

  it('灵化面板 51 + 被动 51：面板基伤与被动基伤是两个独立的值', () => {
    const w = makeTorid(PASSIVE_51);
    const inc = w.modes[1]!;
    const withPassive = compute(w, inc, [], OPTS);
    const withoutPassive = compute(makeTorid(), inc, [], OPTS);
    // 面板 51 × 1 + 被动 51 × 1 = 102；没有被动时是 51
    near(inc.variants[0]!.segments[0]!.damage.toxin!, 51);
    const ratio = segTotal(withPassive, 0) / segTotal(withoutPassive, 0);
    near(ratio, 2, 1e-9);
  });
});

describe('被动 +51：只吃基伤%，不吃镀层 / 冷颤', () => {
  const rate = (stat: string, amount: number) => ({ stat, form: 'pct', amount, source: 'x', slot: 0 });
  const co = (amount: number) => ({ stat: 'co', form: 'pct', amount, source: 'rifle_aptitude', slot: 1 });
  const cold = { stat: 'coFreeze', form: 'pct', amount: 45, source: 'secondary_cold', slot: 2 };

  it('基伤 +100%：面板基伤与被动基伤**都**翻倍', () => {
    const w = makeTorid(PASSIVE_51);
    const inc = w.modes[1];
    const a = compute(w, inc, [], OPTS);
    const b = compute(w, inc, [rate('baseDamage', 100)], OPTS);
    near(segTotal(b, 0) / segTotal(a, 0), 2, 1e-9);
  });

  it('镀层：只放大面板那一路，被动 51 不动', () => {
    const w = makeTorid(PASSIVE_51);
    const inc = w.modes[1];
    // 面板 51 × (1 + 120% × 1 种 × 1 层) = 51 × 2.2 = 112.2
    // 被动 51 × 1 = 51  → 合计 163.2
    const r = compute(w, inc, [co(120)], { ...OPTS, coStacks: 1, coStatusTypes: 1 });
    near(segTotal(r, 0), 51 * 2.2 + 51, 1e-9);
  });

  it('冷颤（类镀层）：同样只放大面板那一路', () => {
    const w = makeTorid(PASSIVE_51);
    const inc = w.modes[1];
    // 冷颤 45% × 固定满层 10 = 450% → 面板 51 × 5.5；被动 51 不吃
    const r = compute(w, inc, [cold], OPTS);
    near(segTotal(r, 0), 51 * 5.5 + 51, 1e-9);
  });

  it('范围伤害（毒云）：镀层与冷颤**都不吃**，两路都只吃基伤%', () => {
    const w = makeTorid(PASSIVE_51);
    const r = compute(w, w.modes[0], [co(120), cold], { ...OPTS, coStacks: 1, coStatusTypes: 1 });
    // 第 2 段是毒云：面板 40 × 1 + 被动 51 × 1 = 91
    near(segTotal(r, 1), 40 + 51, 1e-9);
  });

  it('面板基伤那一路照样吃镀层 / 冷颤（以前 weapon-state 会把冷颤整段关掉，已修）', () => {
    // 灵化模式 + 冷颤：面板基伤那一路应当吃冷颤
    const w = makeTorid();
    const inc = w.modes[1];
    const a = compute(w, inc, [], OPTS);
    const b = compute(w, inc, [cold], OPTS);
    near(segTotal(b, 0) / segTotal(a, 0), 5.5, 1e-9);
  });
});

describe('被动 +51：进入 DoT 基础值（乘区相乘的结果）', () => {
  it('灵化段：被动基伤进了 DoT 基础值，并且吃基伤% 但不吃镀层', () => {
    const w = makeTorid(PASSIVE_51);
    const inc = w.modes[1];
    const base = compute(w, inc, [], OPTS);
    const dotA = base.segments[0].dotTicks.find((t: any) => t.type === 'toxin').baseValue;

    // 没有被动时的 DoT 基础值应当小一截（少 51 那份）
    const noPassive = compute(makeTorid(), inc, [], OPTS);
    const dotNo = noPassive.segments[0].dotTicks.find((t: any) => t.type === 'toxin').baseValue;
    near(dotA / dotNo, 2, 1e-9);

    // 基伤 +100% → 两路都翻倍
    const withBase = compute(w, inc, [{ stat: 'baseDamage', form: 'pct', amount: 100, source: 'x', slot: 0 }], OPTS);
    const dotB = withBase.segments[0].dotTicks.find((t: any) => t.type === 'toxin').baseValue;
    near(dotB / dotA, 2, 1e-9);
  });
});
