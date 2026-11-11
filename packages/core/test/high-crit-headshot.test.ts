/**
 * D-064：暴率 >100%（橙暴/红暴）时，爆头暴击 ×2 仍正确生效。
 *
 * bug 背景：`expectedHitMultiplier` 原来用 `(1−cc)·白字 + cc·暴击` 两支，
 * 但暴率可以超过 100%，此时 `(1−cc)` 变成**负数**，白字支不该存在。
 * 正确做法是按 §3.1 的 `critTiers()` 分档加权，
 * ×2 只作用于**真正暴击**的档位（k ≥ 1）。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../src/index.ts';

const { expectedHitMultiplier, critTiers, compute } = core as any;

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

describe('暴率 >100% 时爆头暴击正确生效（D-064）', () => {
  it('暴率 100%：爆头与非爆头比值 = hsM × cd × 2 ÷ cd', () => {
    // hsM=3, cd=2 → 12 / 2 = 6
    near(expectedHitMultiplier(1, 2, true, 3) / expectedHitMultiplier(1, 2, false, 3), 6);
  });

  it('暴率 150%：全部暴击，比值仍是 6（不会因分档而漂移）', () => {
    near(expectedHitMultiplier(1.5, 2, true, 3) / expectedHitMultiplier(1.5, 2, false, 3), 6);
  });

  it('暴率 200% / 250% / 300%：比值恒为 6', () => {
    for (const cc of [2, 2.5, 3]) {
      near(expectedHitMultiplier(cc, 2, true, 3) / expectedHitMultiplier(cc, 2, false, 3), 6);
    }
  });

  it('暴率 >100% 时非爆头期望与分档期望一致', () => {
    for (const cc of [1, 1.5, 2, 2.5, 3]) {
      const tiers = critTiers(cc, 2);
      const tierExpect = tiers.reduce((s: number, t: any) => s + t.prob * t.mul, 0);
      near(expectedHitMultiplier(cc, 2, false, 3), tierExpect);
    }
  });

  it('暴率 >100% 时爆头期望 = 分档期望 × hsM × 2', () => {
    for (const cc of [1, 1.5, 2, 2.5, 3]) {
      const tiers = critTiers(cc, 2);
      const tierExpect = tiers.reduce((s: number, t: any) => s + t.prob * t.mul, 0);
      near(expectedHitMultiplier(cc, 2, true, 3), tierExpect * 3 * 2);
    }
  });

  it('暴率 >100% 时白字支不存在（不会出现负的 (1−cc)）', () => {
    // cc=1.5 → (1−cc) = −0.5，旧公式会算出错误结果
    const v = expectedHitMultiplier(1.5, 2, false, 3);
    assert.ok(v > 0, `期望倍率应为正，实际 ${v}`);
    // 而且应该大于 cc=1 时的期望（暴率越高伤害越高）
    assert.ok(v > expectedHitMultiplier(1, 2, false, 3));
  });

  it('暴率 150% 的 DoT 比 100% 高', () => {
    const mk = (cc: number) => ({
      id: 'T', name: 'T', critChance: cc, critMultiplier: 2, statusChance: 0.5,
      fireRate: 10, magazineSize: 100, reloadTime: 1,
      modes: [{ id: 'primary', role: 'normal', trigger: 'auto', multishot: 1,
        variants: [{ id: 'direct', label: '直接命中', segments: [{ kind: 'impact', procChance: 0.5, damage: { slash: 100 } }] }] }],
    });
    const hs = { headshot: { enabled: true, multiplier: 3 } };
    const a = compute(mk(1), mk(1).modes[0], [], hs).segments[0].dotTicks[0].tick;
    const b = compute(mk(1.5), mk(1.5).modes[0], [], hs).segments[0].dotTicks[0].tick;
    assert.ok(b > a, `暴率 150% (${b}) 应高于 100% (${a})`);
    near(b / a, 15 / 12); // 分档期望 2.5 vs 2.0
  });

  it('暴率 0% 时没有暴击：爆头只有纯爆头倍率', () => {
    near(expectedHitMultiplier(0, 2, false, 3), 1);
    near(expectedHitMultiplier(0, 2, true, 3), 3);
  });

  it('暴率 50%：白字与暴击各半，×2 只作用于暴击那一半', () => {
    // 非爆头 0.5*1 + 0.5*2 = 1.5
    near(expectedHitMultiplier(0.5, 2, false, 3), 1.5);
    // 爆头 0.5*3 + 0.5*3*2*2 = 1.5 + 6 = 7.5
    near(expectedHitMultiplier(0.5, 2, true, 3), 7.5);
  });

  it('高暴伤（红暴）下比值保持一致', () => {
    // cd = 3，暴率 250%
    const non = expectedHitMultiplier(2.5, 3, false, 3);
    const head = expectedHitMultiplier(2.5, 3, true, 3);
    // 全部暴击 → 比值 = hsM × 2 = 6
    near(head / non, 6);
  });

  // ── D-065：分档语义按需求方确认的口径锁定 ──
  it('暴率 299% = 99% 三级 + 1% 二级（D-065）', () => {
    const tiers = critTiers(2.99, 2);
    // k = floor(2.99) = 2，f = 0.99
    //   二级（k=2）：概率 1−0.99 = 1%
    //   三级（k=3）：概率 0.99    = 99%
    const second = tiers.find((t: any) => t.k === 2);
    const third = tiers.find((t: any) => t.k === 3);
    assert.ok(second && third, '应同时存在二级与三级');
    near(second.prob, 0.01);
    near(third.prob, 0.99);
    assert.ok(Math.abs(second.prob + third.prob - 1) < 1e-9, '概率之和应为 1');
    // 没有低于二级的档（即不存在白字/一级）
    assert.ok(!tiers.some((t: any) => t.k < 2), '暴率 299% 不该有一级或白字');
  });

  it('暴率 299% 的期望倍率 = 0.01×二级 + 0.99×三级', () => {
    const cd = 2;
    const tiers = critTiers(2.99, cd);
    const expect = tiers.reduce((s: number, t: any) => s + t.prob * t.mul, 0);
    // 二级 1+2(cd−1)=3，三级 1+3(cd−1)=4 → 0.01*3 + 0.99*4 = 3.99
    near(expect, 0.01 * 3 + 0.99 * 4);
    near(expectedHitMultiplier(2.99, cd, false, 3), expect);
    // 爆头：全部是暴击 → × hsM × 2 = ×6
    near(expectedHitMultiplier(2.99, cd, true, 3), expect * 6);
  });

  it('整数暴率没有小数部分 → 单档，概率 100%', () => {
    const tiers = critTiers(2, 2);
    const nonzero = tiers.filter((t: any) => t.prob > 0);
    assert.equal(nonzero.length, 1);
    assert.equal(nonzero[0].k, 2);
    near(nonzero[0].prob, 1);
  });

  it('暴率 150% = 50% 二级 + 50% 三级', () => {
    const tiers = critTiers(1.5, 2);
    near(tiers.find((t: any) => t.k === 1).prob, 0.5);
    near(tiers.find((t: any) => t.k === 2).prob, 0.5);
  });

  it('暴率 99% = 99% 一级 + 1% 白字', () => {
    const tiers = critTiers(0.99, 2);
    // k = floor(0.99) = 0，f = 0.99
    //   白字（k=0）：概率 1−0.99 = 1%
    //   一级（k=1）：概率 0.99   = 99%
    near(tiers.find((t: any) => t.k === 0).prob, 0.01);
    near(tiers.find((t: any) => t.k === 1).prob, 0.99);
  });
});
