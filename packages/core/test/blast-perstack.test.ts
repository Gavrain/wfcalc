/**
 * D-056：爆炸每层伤害的两个 bug（回归）。
 *
 * bug 1：`blastBase` 取 `dotBase.blast`，但爆炸几乎全靠 Mod 合成
 *        （火+冰、火+电），而 `dotBase` 是"剔除元素加量"后的分布 → 恒为 0。
 *        按 §6.2 ①，DoT 基础值应取**全类型之和**。
 *
 * bug 2：`critDamageMul` 传的是 `res.line.average`（单弹头**伤害绝对值**），
 *        而不是**暴击倍率**，导致爆炸伤害被放大几十倍。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../src/index.ts';

const { compute } = core as any;

const weapon: any = {
  id: 'TestRifle', name: 'Test',
  critChance: 0.2, critMultiplier: 2, statusChance: 0.5,
  fireRate: 10, magazineSize: 30, reloadTime: 2,
  modes: [{
    id: 'primary', role: 'normal', trigger: 'auto', multishot: 1,
    variants: [{ id: 'direct', label: '直接命中', segments: [{ kind: 'impact', procChance: 0.5, damage: { impact: 100 } }] }],
  }],
};

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

/** 火 + 冰 → 爆炸 */
const blastMods: any[] = [
  { stat: 'elemental:heat', form: 'pct', amount: 90, source: 'hellfire' },
  { stat: 'elemental:cold', form: 'pct', amount: 90, source: 'cryo' },
];

describe('爆炸每层伤害（D-056）', () => {
  it('合成出的爆炸能算出非零的每层伤害', () => {
    const res = compute(weapon, weapon.modes[0], blastMods, {});
    assert.ok(res.segments[0].finalHit.blast > 0, '命中分布里应有爆炸');
    assert.ok(res.output.blast.perStack > 0,
      `每层伤害应 > 0，实际 ${res.output.blast.perStack}`);
  });

  it('每层伤害 = 全类型基础值 × 0.3 × 暴击期望（基础值里已含暴击期望）', () => {
    const res = compute(weapon, weapon.modes[0], blastMods, {});
    const seg: any = res.segments[0];
    // ⚠ D-107：面板里的基础分布（**不含**元素 Mod 加量）= 冲击 100
    const baseTotal = Object.values(seg.tickBase).reduce((a: number, v: any) => a + v, 0);
    // 爆炸基础值 = 该分布 × 期望倍率(1.2)，再 × 系数 0.3
    const expectedMul = 1 + seg.critChance * (seg.critDamage - 1);
    near(res.output.blast.perStack, baseTotal * expectedMul * 0.3);
  });

  it('每层伤害量级合理（不超过基础值的 3 倍）', () => {
    const res = compute(weapon, weapon.modes[0], blastMods, {});
    const seg: any = res.segments[0];
    const baseTotal = Object.values(seg.tickBase).reduce((a: number, v: any) => a + v, 0);
    // 系数 0.3 × 暴击期望(1.2) = 0.36 倍基础值，绝不该是几十倍
    assert.ok(res.output.blast.perStack < baseTotal * 3,
      `每层 ${res.output.blast.perStack} 不应超过基础值 ${baseTotal} 的 3 倍`);
  });

  it('暴击不计入时（暴率 0）每层伤害 = 基础值 × 0.3', () => {
    const noCrit: any = { ...weapon, critChance: 0 };
    const res = compute(noCrit, noCrit.modes[0], blastMods, {});
    const seg: any = res.segments[0];
    const baseTotal = Object.values(seg.tickBase).reduce((a: number, v: any) => a + v, 0);
    near(res.output.blast.perStack, baseTotal * 0.3);
  });

  it('没有爆炸元素时每层伤害仍为 0（D-055 不被破坏）', () => {
    const res = compute(weapon, weapon.modes[0], [], {});
    near(res.output.blast.perStack, 0);
    near(res.output.blast.perSecond, 0);
    assert.equal(res.output.blast.stacksPerSecond, 0);
  });

  it('爆炸倍率随暴伤提升，且是**倍率**不是绝对伤害', () => {
    const a = compute(weapon, weapon.modes[0], blastMods, {});
    const b = compute(weapon, weapon.modes[0], [
      ...blastMods,
      { stat: 'critMultiplier', form: 'pct', amount: 100, source: 'vital_sense' },
    ], {}, false);

    // 注意：dotBase 里已含暴击期望（D-041），所以加暴伤后**基础值本身**也会变。
    // 正确做法是分别按各自的基础值与暴击期望复算，再比对。
    // D-063：dotBase 已含完整期望倍率，blast 不再单独乘
    const calc = (r: any) => {
      const seg = r.segments[0];
      const baseTotal = Object.values(seg.dotBase).reduce((x: number, v: any) => x + v, 0);
      return baseTotal * 0.3;
    };
    const ea = calc(a);
    const eb = calc(b);
    near(a.output.blast.perStack, ea);
    near(b.output.blast.perStack, eb);
    // 暴伤翻倍后爆炸每层伤害应上升
    assert.ok(b.output.blast.perStack > a.output.blast.perStack,
      `暴伤提升后每层伤害应上升：${a.output.blast.perStack} → ${b.output.blast.perStack}`);
    // 且不是被放大几十倍的那种错误量级
    const baseTotalB = Object.values(b.segments[0].dotBase).reduce((x: number, v: any) => x + v, 0);
    assert.ok(b.output.blast.perStack < baseTotalB * 3, '每层伤害量级应合理');
  });
});
