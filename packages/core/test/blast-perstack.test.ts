/**
 * D-056：爆炸每层伤害的两个 bug（回归）。
 *
 * bug 1：`blastBase` 取 `dotBase.blast`，但爆炸几乎全靠 Mod 合成
 *        （火+冰、火+电），而 `dotBase` 是"剔除元素加量"后的分布 → 恒为 0。
 *        按 §6.2 ①，DoT 基础值应取**全类型之和**。
 *
 * bug 2：`critDamageMul` 传的是 `res.line.average`（单弹头**伤害绝对值**），
 *        而不是**暴击倍率**，导致爆炸被放大几十倍。
 *
 * ⚠ 需求方 2026-11-14：这几条原先是从内核读中间值 `tickBase`、再乘期望倍率去比 `perStack`——
 *   而 `perStack` 内部就是 `tickBaseScaled × 0.3`，`tickBaseScaled` 又正好是
 *   `tickBase × 期望`，等于**同一条式子的左右两边**，实现没改就恒成立，抓不到 D-056。
 *   现在改为拿**面板上的实数**（冲击 100）直接断言，中间值一个都不读。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../src/index.ts';

const { compute } = core as any;

/** 面板：冲击 100。下面所有断言都以这个实数作为"基础值"的判据 */
const PANEL_TOTAL = 100;

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

/** 面板暴率 0.2 / 暴伤 2 → 期望倍率 = 1 + 0.2 × (2 − 1) = 1.2（不含爆头） */
const EXPECTED_MUL = 1 + 0.2 * (2 - 1);

/** §6.2 ①：爆炸基础值 = 命中分布的**全类型之和**，且不含元素 Mod 加量 */
const BLAST_COEF = 0.3;

describe('爆炸每层伤害（D-056）', () => {
  it('合成出的爆炸能算出非零的每层伤害', () => {
    const res = compute(weapon, weapon.modes[0], blastMods, {});
    assert.ok(res.segments[0].finalHit.blast > 0, '命中分布里应有爆炸');
    assert.ok(res.output.blast.perStack > 0,
      `每层伤害应 > 0，实际 ${res.output.blast.perStack}`);
  });

  it('每层 = 面板基础值(100) × 0.3 × 期望倍率 —— 元素 Mod 不进基础值', () => {
    const res = compute(weapon, weapon.modes[0], blastMods, {});
    // 火 + 冰是 Mod 合成的元素加量，**不进** DoT / 爆炸基础值（§6.2 ①）
    near(res.output.blast.perStack, PANEL_TOTAL * BLAST_COEF * EXPECTED_MUL);
  });

  it('暴率 0 时每层 = 面板基础值(100) × 0.3', () => {
    const noCrit: any = { ...weapon, critChance: 0 };
    const res = compute(noCrit, noCrit.modes[0], blastMods, {});
    near(res.output.blast.perStack, PANEL_TOTAL * BLAST_COEF);
  });

  it('多段武器：爆炸基础值取该段自己的面板，不是全武器总和', () => {
    // 两段：冲击 100 / 冲击 40，爆炸仍按各自段的面板算基础值
    const twoSeg: any = {
      ...weapon,
      modes: [{
        id: 'primary', role: 'normal', trigger: 'auto', multishot: 1,
        variants: [{
          id: 'direct', label: '直接命中',
          segments: [
            { kind: 'impact', procChance: 0.5, damage: { impact: 100 } },
            { kind: 'impact', procChance: 0.5, damage: { impact: 40 } },
          ],
        }],
      }],
    };
    const res = compute(twoSeg, twoSeg.modes[0], blastMods, {});
    // 每段各自 0.3 × 期望：100 与 40
    near(res.output.dotBySegment[0].blast.perStack, 100 * BLAST_COEF * EXPECTED_MUL);
    near(res.output.dotBySegment[1].blast.perStack, 40 * BLAST_COEF * EXPECTED_MUL);
  });

  it('没有爆炸元素时每层伤害仍为 0（D-055 不被破坏）', () => {
    const res = compute(weapon, weapon.modes[0], [], {});
    near(res.output.blast.perStack, 0);
    near(res.output.blast.totalInWindow ?? 0, 0);
    assert.equal(res.output.blast.stacksPerSecond, 0);
  });

  it('爆炸倍率随暴伤提升，且是**倍率**不是绝对伤害（D-056 bug 2）', () => {
    const a = compute(weapon, weapon.modes[0], blastMods, {});
    const b = compute(weapon, weapon.modes[0], [
      ...blastMods,
      { stat: 'critMultiplier', form: 'pct', amount: 100, source: 'vital_sense' },
    ], {}, false);

    // 暴伤 2 → +100% 后是 4；期望倍率 = 1 + cc × (cd − 1)
    // 每层伤害必须由**面板数字**推出，不能从内核读中间值再乘回去
    const mulA = 1 + 0.2 * (2 - 1);   // 1.2
    const mulB = 1 + 0.2 * (4 - 1);   // 1.6
    near(a.output.blast.perStack, PANEL_TOTAL * BLAST_COEF * mulA);
    near(b.output.blast.perStack, PANEL_TOTAL * BLAST_COEF * mulB);

    // bug 2 的特征：如果误把「单弹头绝对伤害」当倍率，每层会被放大到几十倍
    // 这里断言它只是基础值的 0.3~0.5 倍量级，不是几十倍
    assert.ok(b.output.blast.perStack < PANEL_TOTAL,
      `每层 ${b.output.blast.perStack} 不应超过面板基础值 ${PANEL_TOTAL}（误乘绝对伤害的特征）`);
  });
});
