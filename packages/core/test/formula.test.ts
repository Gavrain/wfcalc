/**
 * 结算链测试 —— 直接对应 `docs/伤害公式.md` §11 的校验例 1~7。
 * 测试名带文档小节号，改代码前先看文档。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyElements,
  applyKuvaBonus,
  applyBaseDamage,
  critAverage,
  critTiers,
  damageLine,
  mergePairwise,
  multishot,
  overForStacks,
  pairOf,
  PAIRS,
} from '../src/index.ts';
import type { Contribution, ElementSlot } from '../src/index.ts';

const near = (a: number | undefined, b: number, eps = 1e-9) =>
  assert.ok(a !== undefined && Math.abs(a - b) < eps, `期望 ${b}，实际 ${a}`);

const pct = (stat: Contribution['stat'], percent: number, slot?: number): Contribution =>
  slot === undefined ? { stat, form: 'pct', amount: percent, source: 'test' } : { stat, form: 'pct', amount: percent, source: 'test', slot };

const HIT = { kind: 'impact' as const };

describe('§11 校验例（来自乘区归属表与需求方裁定）', () => {
  it('例 1（4.1 / A-14 = 口径 A）：面板 100 冲 + 100 切，+100% 冲、+100% 毒 → 200/100/200', () => {
    // 元素 % 的基数 = ①玄骸 + ②基伤（**不含物理 %Mod**）：100 + 100 = 200
    //   ⇒ 毒加量 = 200 × 100% = 200
    // ⚠ 与 `伤害公式.md` §11 旧写法「毒 300」不同；「200」与乘区归属表 4.1 校验例一致。
    //    待确认见 `docs/decisions.md` D-022。
    const contribs = [pct('elemental:toxin', 100), pct('physical:impact', 100)];
    const base = applyBaseDamage({ impact: 100, slash: 100 }, HIT, contribs);
    const r = applyElements(base, contribs, 'hit').v;
    near(r.impact, 200);
    near(r.slash, 100);
    near(r.toxin, 200);
  });

  it('例 2（4.4）：面板 40，60% 磁力 → 磁力 24；再 +100% 毒 → 毒气 74、磁力保持 24', () => {
    const k = applyKuvaBonus({ puncture: 10, slash: 10, impact: 10, heat: 10 }, { type: 'magnetic', ratio: 0.6 });
    near(k.magnetic, 24);
    // 新总伤 64；+100% 毒 → 毒加量 64；毒 64 + 面板火 10 = 74 毒气
    const contribs = [pct('elemental:toxin', 100)];
    const base = applyBaseDamage(k, HIT, contribs);
    const r = applyElements(base, contribs, 'hit').v;
    near(r.gas, 74);
    near(r.magnetic, 24); // 复合元素不参与配对
  });

  it('例 3（3.1）：暴率 150%、爆伤 2.0 → 平均 ×2.5，分档 1(50%,2.0×) / 2(50%,3.0×)', () => {
    near(critAverage(1, 1.5, 2.0), 2.5);
    assert.deepEqual(critTiers(1.5, 2.0), [
      { k: 1, prob: 0.5, mul: 2.0 },
      { k: 2, prob: 0.5, mul: 3.0 },
    ]);
  });

  it('例 4（§5.4 / D-006）：面板 10 火 + 槽1 火 + 槽2 毒 → 毒气 370，无残余火', () => {
    // 题意：新面板总伤 = 200，且面板自带火 10 之外不含火/毒。
    // 底座 = 物理 200（只有物理，元素 % 的基数才是纯 200）；面板自带火 10 另在槽位里
    const contribs = [pct('elemental:heat', 90, 1), pct('elemental:toxin', 90, 2)];
    const r = applyElements({ slash: 190, heat: 10 }, contribs, 'hit');
    // 火Slot = 面板10 + 火Mod180 = 190；火190 与 毒180 配对 → 毒气 370
    near(r.v.gas, 370);
    assert.equal(r.v.heat, undefined); // 无残余火
    near(r.v.slash, 190);
  });

  it('例 5（D-012 / D-020）：爆头 ×2 只作用于暴击', () => {
    const h = damageLine(100, 1.0, 4.0, true, 3);
    near(h.nonCrit, 300); // 100 × 3，不暴击不乘 2
    near(h.crit, 2400); // 100 × 3 × 4 × 2
    near(h.average, 2400); // 暴率 100%
    const noHead = damageLine(100, 1.0, 4.0, false, 3);
    near(noHead.crit, 400); // 不勾爆头：100 × 4（爆头倍率整项不存在）
    // D-020：暴率 50% 时，未暴击那半不乘 2 → 0.5×300 + 0.5×2400 = 1350
    near(damageLine(100, 0.5, 4.0, true, 3).average, 1350);
    // 暴率 0：平均 = 不暴击行
    near(damageLine(100, 0, 4.0, true, 3).average, 300);
  });

  it('例 7（D-017）：玄骸吃基伤 —— 面板 40、60% 磁力、+165% 基伤', () => {
    const kuva = applyKuvaBonus({ puncture: 10, slash: 10, impact: 10, heat: 10 }, { type: 'magnetic', ratio: 0.6 });
    const contribs = [pct('baseDamage', 165)];
    const after = applyBaseDamage(kuva, HIT, contribs);
    near(after.magnetic, 24 * 2.65); // 63.6
    const total = Object.values(after).reduce<number>((a, b) => a + (b ?? 0), 0);
    near(total, 169.6); // (40+24) × 2.65
  });
});

describe('§5.3 元素加量与两两合成', () => {
  it('同类型先加总成一个槽位（D-006）', () => {
    const contribs = [pct('elemental:heat', 90, 1), pct('elemental:heat', 90, 2)];
    const r = applyElements({ slash: 100 }, contribs, 'hit');
    // 底座总伤 100，两张火卡合计 180% → 一个槽位 180
    const heatSlot = r.slots.filter((s) => s.type === 'heat');
    assert.equal(heatSlot.length, 1);
    near(heatSlot[0]!.amount, 180);
  });

  it('面板元素先入队：面板火 + Mod 火 → 先并成火，再与毒配成毒气', () => {
    const contribs = [pct('elemental:heat', 90, 1), pct('elemental:toxin', 90, 2)];
    const r = applyElements({ heat: 10, slash: 90 }, contribs, 'hit');
    // 新面板总伤 = 100 → 火Mod 90 / 毒Mod 90；面板火 10 先入队
    // 面板火 10 + 火Mod 90 = 火 100，再与毒 90 配 → 毒气 190（与 §5.4 例 C 同构）
    near(r.v.gas, 190);
    assert.equal(r.v.heat, undefined);
  });

  it('复合元素不参与配对（磁力保持独立）', () => {
    assert.equal(pairOf('heat', 'toxin'), 'gas');
    assert.equal(pairOf('magnetic', 'heat'), null);
    const r = applyElements({ magnetic: 24, heat: 10, toxin: 10 }, [], 'hit');
    near(r.v.magnetic, 24);
    near(r.v.gas, 20);
  });

  it('六种复合元素：两种配对顺序都必须成立（曾经的排序 bug）', () => {
    // 曾用 [a, b].sort() 拼 key，而表里写的是固定顺序，导致六种配对**全部失效**。
    const cases: [string, string, string][] = [
      ['heat', 'cold', 'blast'],
      ['heat', 'toxin', 'gas'],
      ['heat', 'electric', 'radiation'],
      ['cold', 'toxin', 'viral'],
      ['cold', 'electric', 'magnetic'],
      ['toxin', 'electric', 'corrosive'],
    ];
    for (const [a, b, expect] of cases) {
      assert.equal(pairOf(a as never, b as never), expect, `${a}+${b}`);
      assert.equal(pairOf(b as never, a as never), expect, `${b}+${a}（反序）`);
      assert.equal(PAIRS[`${a}+${b}`], expect);
      assert.equal(PAIRS[`${b}+${a}`], expect);
    }
  });

  it('火 + 冰 → 爆炸（端到端，曾经算出未配对的火与冰）', () => {
    const r = applyElements({ heat: 100, cold: 50 }, [], 'hit');
    near(r.v.blast, 150);
    assert.equal(r.v.heat, undefined);
    assert.equal(r.v.cold, undefined);
  });

  it('反序输入也能合成：冰 + 火 → 爆炸', () => {
    const r = applyElements({ cold: 50, heat: 100 }, [], 'hit');
    near(r.v.blast, 150);
  });

  it('同槽位两张火卡与毒卡：火先并、再与毒配（顺序稳定）', () => {
    const r = applyElements({ slash: 100 }, [pct('elemental:heat', 60, 5), pct('elemental:toxin', 60, 3)], 'hit');
    near(r.v.gas, 120);
  });
});

describe('§5.2 基伤与多重', () => {
  it('多重与基伤相乘、绝不相加', () => {
    assert.equal(multishot([pct('multishot', 90)]), 1.9);
  });

  it('AoE 段不吃基伤（按文档：AoE 只吃 (1+Σ基伤Mod%)，此处 k=1+Σ 与普通段同式）', () => {
    const contribs = [pct('baseDamage', 100)];
    const normal = applyBaseDamage({ impact: 10 }, { kind: 'attack' }, contribs);
    const aoe = applyBaseDamage({ impact: 10 }, { kind: 'explosiveAttack' }, contribs);
    near(normal.impact, 20);
    near(aoe.impact, 20);
  });

  it('镀层类：无叠层或无异常状态时不生效（A-03 / D-024）', () => {
    const contribs = [pct('baseDamage', 100), { stat: 'co' as const, form: 'pct' as const, amount: 30, source: 'co' }];
    const noStacks = applyBaseDamage({ impact: 10 }, { kind: 'attack' }, contribs, 0, 3);
    near(noStacks.impact, 20); // 只吃 +100% 基伤
    const noStatus = applyBaseDamage({ impact: 10 }, { kind: 'attack' }, contribs, 2, 0);
    near(noStatus.impact, 20); // 目标没有异常状态
  });

  it('镀层类：加量 = x% × a × y（D-024 需求方原话）', () => {
    // 镀层步枪才能：x=20%、y=2；目标 3 种异常 ⇒ +20% × 3 × 2 = +120%
    const contribs = [{ stat: 'co' as const, form: 'pct' as const, amount: 20, source: 'galvanized_aptitude' }];
    near(overForStacks(contribs, 2, 3), 1.2);
    near(overForStacks(contribs, 2, 1), 0.4);
    near(overForStacks(contribs, 1, 3), 0.6);
    // 无基伤 Mod 时：面板 100 × (1 + 1.2) = 220
    near(applyBaseDamage({ impact: 100 }, { kind: 'attack' }, contribs, 2, 3).impact, 220);
  });

  it('镀层类：a 是"种类数"不是层数（同类型多张 Mod 相加后再乘 a×y）', () => {
    const contribs = [
      { stat: 'co' as const, form: 'pct' as const, amount: 20, source: 'm1' },
      { stat: 'co' as const, form: 'pct' as const, amount: 80, source: 'm2' },
    ];
    // Σx = 100%，a=2，y=1 ⇒ +200%
    near(overForStacks(contribs, 1, 2), 2);
  });

  it('镀层类不进 AoE 段（表 2.1）', () => {
    const contribs = [{ stat: 'co' as const, form: 'pct' as const, amount: 20, source: 'co' }];
    const aoe = applyBaseDamage({ impact: 100 }, { kind: 'explosiveAttack' }, contribs, 2, 3);
    near(aoe.impact, 100); // AoE 不吃镀层
    const normal = applyBaseDamage({ impact: 100 }, { kind: 'attack' }, contribs, 2, 3);
    near(normal.impact, 220);
  });
});
