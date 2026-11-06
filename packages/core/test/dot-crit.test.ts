/**
 * §6.2 ①：DoT 基础值【享受暴击】（回归）。
 *
 * 文档原文：
 *   「① 基础命中伤 … 保留：基伤%、多重%、**暴击**」
 *   「② 基础触发值 = ① × 该元素系数 · 该值【享受暴击】——即 ① 里已含暴击期望」
 *
 * bug 背景：`dotBase` 是在暴击结算**之前**算的，导致暴击类 Mod 对 DoT 完全没有增益。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../src/index.ts';

const { compute } = core as any;

const weapon: any = {
  id: 'TestRifle',
  name: 'Test Rifle',
  critChance: 0.2,
  critMultiplier: 2,
  statusChance: 0.5,
  fireRate: 10,
  magazineSize: 30,
  reloadTime: 2,
};

const mode: any = {
  id: 'primary',
  role: 'primary',
  trigger: 'auto',
  multishot: 1,
  variants: [{ id: 'direct', label: '直接命中', segments: [{ kind: 'physical', procChance: 0.5, damage: { slash: 100 } }] }],
};

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

const dotPerSecond = (r: any) => r.output.dotPerSecond as number;

describe('DoT 享受暴击（§6.2 ①）', () => {
  it('暴击几率 Mod 会提升 DoT 输出', () => {
    const base = compute(weapon, mode, [], {}, false);
    const withCrit = compute(weapon, mode, [
      { stat: 'critChance', form: 'pct', amount: 150, source: 'point_strike' },
    ], {}, false);
    assert.ok(dotPerSecond(withCrit) > dotPerSecond(base),
      `加暴率后 DoT 应上升：${dotPerSecond(base)} → ${dotPerSecond(withCrit)}`);
  });

  it('暴击伤害 Mod 会提升 DoT 输出', () => {
    const base = compute(weapon, mode, [], {}, false);
    const withCd = compute(weapon, mode, [
      { stat: 'critMultiplier', form: 'pct', amount: 120, source: 'vital_sense' },
    ], {}, false);
    assert.ok(dotPerSecond(withCd) > dotPerSecond(base),
      `加暴伤后 DoT 应上升：${dotPerSecond(base)} → ${dotPerSecond(withCd)}`);
  });

  it('基础值含暴击期望：dotBase = 剔除元素加量的命中伤 × (1 + 暴率 × (暴伤 − 1))', () => {
    const res = compute(weapon, mode, [], {}, false);
    const seg: any = res.segments[0];
    const cc = seg.critChance;
    const cd = seg.critDamage;
    // 面板只有切割 100，无元素/物理 Mod → 剔除加量后仍是 100
    const raw = 100;
    const expect = raw * (1 + cc * (cd - 1));
    near(seg.dotTicks[0].baseValue, expect);
  });

  it('暴击几率 0 时，DoT 基础值等于原始命中伤', () => {
    const noCrit: any = { ...weapon, critChance: 0 };
    const res = compute(noCrit, mode, [], {}, false);
    const seg: any = res.segments[0];
    near(seg.dotTicks[0].baseValue, 100);
  });

  it('暴击提升的幅度与期望倍率一致', () => {
    const base = compute(weapon, mode, [], {}, false);
    const withCd = compute(weapon, mode, [
      { stat: 'critMultiplier', form: 'pct', amount: 100, source: 'vital_sense' },
    ], {}, false);

    const b = base.segments[0];
    const a = withCd.segments[0];
    const ratioB = 1 + b.critChance * (b.critDamage - 1);
    const ratioA = 1 + a.critChance * (a.critDamage - 1);
    // DoT 的比值应与暴击期望倍率之比一致
    near(dotPerSecond(withCd) / dotPerSecond(base), ratioA / ratioB, 1e-5);
  });
});
