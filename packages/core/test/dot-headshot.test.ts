/**
 * D-062：爆头 / 爆头暴击作用在 **DoT 基础值**上。
 *
 * 需求方口径：
 *   「爆头影响基础值计算。爆头暴击也是对基础值生效，dot 部分都应该以基础值为准。
 *     参考暴击，dot 部分会额外生效的只有派系伤害和元素异常状态伤害这两种词条，
 *     射速和多重影响的是叠层。」
 *
 * 所以：
 *   基础值 = 命中基础 × 暴击期望 × 爆头倍率 × (爆头暴击 ? 2 : 1)
 *   每跳   = 基础值 × 系数 × (1+元素%) × (1+异常%) × (1+派系%)
 *   —— 爆头**不在**每跳里再乘一次。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../src/index.ts';

const { compute, expectedHitMultiplier } = core as any;

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

function makeWeapon() {
  return {
    id: 'T', name: 'T',
    critChance: 0.5, critMultiplier: 2, statusChance: 0.5,
    fireRate: 10, magazineSize: 100, reloadTime: 1,
    modes: [{
      id: 'primary', role: 'normal', trigger: 'auto', multishot: 1,
      variants: [{ id: 'direct', label: '直接命中', segments: [{ kind: 'physical', procChance: 0.5, damage: { slash: 100 } }] }],
    }],
  };
}

const hs = (enabled: boolean, mult = 3) => ({ headshot: { enabled, multiplier: mult } });

const dotOf = (opts: any, contribs: any[] = []) => {
  const w = makeWeapon();
  const r = compute(w, w.modes[0], contribs, opts);
  const seg: any = r.segments[0];
  return { res: r, seg, tick: seg.dotTicks.find((t: any) => t.type === 'slash') };
};

describe('爆头作用在 DoT 基础值上（D-062 / D-063）', () => {
  it('expectedHitMultiplier：未暴击时爆头就是纯爆头倍率（不做 ×2）', () => {
    // cc = 0：全是白字
    near(expectedHitMultiplier(0, 2, false, 3), 1);
    near(expectedHitMultiplier(0, 2, true, 3), 3); // 只有爆头，没有爆头暴击
    near(expectedHitMultiplier(0, 2, true, 2), 2);
  });

  it('expectedHitMultiplier：全部暴击时，爆头暴击 ×2 才生效', () => {
    // cc = 1：全是暴击
    near(expectedHitMultiplier(1, 2, false, 3), 2); // 只暴击：cd
    near(expectedHitMultiplier(1, 2, true, 3), 3 * 2 * 2); // 爆头 ∧ 暴击：hsM × cd × 2
  });

  it('expectedHitMultiplier：中间暴击率按加权平均', () => {
    // cc = 0.5, cd = 2, hs = 3
    // 非爆头：0.5×1 + 0.5×2 = 1.5
    near(expectedHitMultiplier(0.5, 2, false, 3), 1.5);
    // 爆头：0.5×3 + 0.5×3×2×2 = 1.5 + 6 = 7.5
    near(expectedHitMultiplier(0.5, 2, true, 3), 7.5);
  });

  it('爆头 × 暴击率 0 时，DoT 只吃纯爆头倍率（3 倍，不是 6 倍）', () => {
    const w = makeWeapon();
    w.critChance = 0;
    const a = compute(w, w.modes[0], [], hs(false));
    const b = compute(w, w.modes[0], [], hs(true, 3));
    near(b.segments[0].dotTicks[0].tick / a.segments[0].dotTicks[0].tick, 3);
  });

  it('爆头 × 全额暴击时，DoT 提升 12 倍（3 × 2 × 2）', () => {
    const w = makeWeapon();
    w.critChance = 1;
    const a = compute(w, w.modes[0], [], hs(false));
    const b = compute(w, w.modes[0], [], hs(true, 3));
    // 非爆头：cd = 2；爆头：3 × 2 × 2 = 12 → 比值 6
    near(b.segments[0].dotTicks[0].tick / a.segments[0].dotTicks[0].tick, 12 / 2);
  });

  it('爆头暴击 ×2 按暴击率加权（不是恒定 2 倍）', () => {
    const w = makeWeapon(); // cc 0.5, cd 2
    const a = compute(w, w.modes[0], [], hs(false));
    const b = compute(w, w.modes[0], [], hs(true, 3));
    // 非爆头期望 1.5；爆头期望 7.5 → 比值 5
    near(b.segments[0].dotTicks[0].tick / a.segments[0].dotTicks[0].tick, 5);
  });

  it('dotTick.headshotMul 恒为 1（爆头已并进基础值，不重复乘）', () => {
    const b = dotOf(hs(true, 3));
    near(b.tick.headshotMul, 1);
    const expected = b.tick.baseTick * (1 + b.tick.elementPct) *
      (1 + b.tick.statusDamagePct) * (1 + b.tick.factionPct);
    near(b.tick.tick, expected);
  });

  it('爆炸与 DoT 用同一套基础值倍率（不重复乘）', () => {
    const w: any = makeWeapon();
    w.critChance = 1;
    // D-080：段只属于变体——直接改变体内的段
    w.modes[0].variants[0].segments[0].damage = { impact: 100 };
    const mods = [
      { stat: 'elemental:heat', form: 'pct', amount: 90, source: 'h' },
      { stat: 'elemental:cold', form: 'pct', amount: 90, source: 'c' },
    ];
    const a = compute(w, w.modes[0], mods, hs(false));
    const b = compute(w, w.modes[0], mods, hs(true, 3));
    // 全额暴击：非爆头 cd=2；爆头 3×2×2=12 → 比值 6
    near(b.output.blast.perStack / a.output.blast.perStack, 6);
  });

  it('实弹：多重不影响每层秒伤（只影响叠层）', () => {
    const base = dotOf(hs(false));
    const withMs = dotOf(hs(false), [{ stat: 'multishot', form: 'pct', amount: 90, source: 'ms' }]);
    const withFr = dotOf(hs(false), [{ stat: 'fireRate', form: 'pct', amount: 60, source: 'fr' }]);
    near(withMs.tick.tick, base.tick.tick);
    near(withFr.tick.tick, base.tick.tick);
    assert.ok(withMs.res.output.dot6s > base.res.output.dot6s);
    assert.ok(withFr.res.output.dot6s > base.res.output.dot6s);
  });

  it('DoT 上额外生效的词条只有「异常状态伤害%」与「元素%」', () => {
    const base = dotOf(hs(false));
    const withStatus = dotOf(hs(false), [
      { stat: 'statusDamage', form: 'pct', amount: 100, source: 'sd' },
    ]);
    near(withStatus.tick.tick, base.tick.tick * 2);

    const withBase = dotOf(hs(false), [
      { stat: 'baseDamage', form: 'pct', amount: 100, source: 'serration' },
    ]);
    assert.ok(withBase.tick.tick > base.tick.tick);
    near(withBase.tick.elementPct, base.tick.elementPct);
    near(withBase.tick.statusDamagePct, base.tick.statusDamagePct);
  });
});
