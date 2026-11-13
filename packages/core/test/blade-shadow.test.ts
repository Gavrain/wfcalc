/**
 * D-189：近战·刃影 —— 收益关于暴击率的式子。
 *
 * 需求方 2026-11-13 逐轮确认的最终口径：
 *   · 主命中**正好是一级暴击**才触发（二级暴击不触发）；
 *   · 追加那一下按**同一暴击率独立再判**，可能是未暴击 / 一级 / 二级；
 *   · 手算验算（cd=4、暴击率 110%、满级）：
 *     `0.1×(7+0) + 0.9×(0.1×(4+7) + 0.9×(4+4)) = 8.17`
 *   · **只放大叠层**：DoT / 爆炸的每跳基础值不放大。
 *
 * 式子：
 * ```
 * P1(cc) = cc ≤ 1 ? cc : max(0, 2 − cc)
 * 刃影倍率 = 1 + w·P1(cc)
 * 增益（相对同一配装去掉刃影）= w·P1(cc)，与暴伤无关
 * ```
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { bladeShadowGain, bladeShadowMultiplier, firstTierCritChance } from '../src/crit.ts';
import { compute } from '../src/compute.ts';
import { simpleMode } from './_helpers.ts';
import type { Contribution } from '../src/contributions.ts';
import type { Weapon } from '../src/weapon.ts';

const near = (a: number, b: number, eps = 1e-9): void =>
  assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

/** 需求方手算的 8.17（cd=4、暴击率 110%、满级刃影） */
function handCalc110(): number {
  const cd = 4;
  const m1 = 1 + 1 * (cd - 1); // 4
  const m2 = 1 + 2 * (cd - 1); // 7
  const f = 0.1;
  // 一级暴击支：本段 4 + 追加（10% 二级 → 7，90% 一级 → 4）
  const mainFirst = (1 - f) * (m1 + f * m2 + (1 - f) * m1);
  // 二级暴击支：本段 7，刃影不触发 → 追加 0
  const mainSecond = f * (m2 + 0);
  return mainFirst + mainSecond;
}

const blade = (amount = 100): Contribution => ({ stat: 'bladeShadow', form: 'pct', amount, source: 'ReplayLightCritHits' });

/** 暴击率 / 暴伤可调的近战 */
function melee(cc: number, cd: number): Weapon {
  return {
    id: 'TestMelee',
    name: 'Test Melee',
    category: 'melee',
    critChance: cc,
    critMultiplier: cd,
    statusChance: 0.2,
    fireRate: 1,
    modes: [],
  } as unknown as Weapon;
}

const slashMode = () =>
  simpleMode({ id: 'primary', role: 'normal', trigger: 'active', bullets: 1, multishot: 1 }, { slash: 100 }, 'impact', 0.3);

describe('刃影：收益式子（D-189）', () => {
  it('需求方手算式 = 8.17', () => {
    near(handCalc110(), 8.17);
  });

  it('一级暴击概率：cc≤1 取 cc，1≤cc≤2 取 2−cc，cc≥2 取 0', () => {
    near(firstTierCritChance(0), 0);
    near(firstTierCritChance(0.5), 0.5);
    near(firstTierCritChance(1), 1);
    near(firstTierCritChance(1.1), 0.9);
    near(firstTierCritChance(1.5), 0.5);
    near(firstTierCritChance(1.9), 0.1);
    near(firstTierCritChance(2), 0);
    near(firstTierCritChance(2.5), 0);
  });

  it('用公式复算手算式：B + P1·w·A = 8.17（同分母前的总倍率）', () => {
    // B = 4.3，P1·w·A = 0.9 × 4.3 = 3.87，刃影倍率 = 1.9
    const cc = 1.1;
    const cd = 4;
    near(bladeShadowMultiplier(cc, 1), 1 + 0.9);
    near(4.3 * bladeShadowMultiplier(cc, 1), handCalc110());
  });

  it('cd=3.8 典型值：暴击率 0~2 的增益表', () => {
    const table: [number, number][] = [
      [0.0, 0],
      [0.5, 0.5],
      [1.0, 1.0],
      [1.1, 0.9],
      [1.2, 0.8],
      [1.3, 0.7],
      [1.4, 0.6],
      [1.5, 0.5],
      [1.6, 0.4],
      [1.8, 0.2],
      [1.9, 0.1],
      [2.0, 0],
    ];
    for (const [cc, expect] of table) near(bladeShadowGain(cc, 1), expect);
    // 峰值在 100% 暴击率
    assert.ok(bladeShadowGain(1, 1) >= bladeShadowGain(1.1, 1));
  });

  it('等级概率按比例缩放', () => {
    for (const w of [0.25, 0.55, 1.0]) near(bladeShadowGain(1.1, w), w * 0.9);
  });

  it('未装刃影 / 暴率 0 / 暴率 ≥2：倍率恒为 1', () => {
    near(bladeShadowMultiplier(1.1, 0), 1);
    near(bladeShadowMultiplier(0, 1), 1);
    near(bladeShadowMultiplier(2, 1), 1);
    near(bladeShadowMultiplier(2.4, 1), 1);
  });
});

describe('刃影：端到端只放大叠层、不放大每跳（D-189）', () => {
  it('单弹头 = 原来 × 刃影倍率', () => {
    const w = melee(1.1, 3.8);
    const m = slashMode();
    const before = compute(w, m, []).output.pelletPerHit;
    const after = compute(w, m, [blade()]).output.pelletPerHit;
    near(after / before, bladeShadowMultiplier(1.1, 1));
  });

  it('白字 / 暴击两行不乘刃影（仍是单次结算）', () => {
    const w = melee(1.1, 3.8);
    const m = slashMode();
    const a = compute(w, m, [blade()]).segments[0]!.line;
    const b = compute(w, m, []).segments[0]!.line;
    near(a.nonCrit, b.nonCrit);
    near(a.crit, b.crit);
    near(a.average, b.average * bladeShadowMultiplier(1.1, 1));
  });

  it('每跳基础值不变，叠层按刃影倍率放大', () => {
    const w = melee(1.1, 3.8);
    const m = slashMode();
    const base = compute(w, m, []);
    const withBlade = compute(w, m, [blade()]);
    const mul = bladeShadowMultiplier(1.1, 1);

    const tickBase = base.output.dotBySegment[0]!.dotPerType.slash ?? 0;
    const tickBlade = withBlade.output.dotBySegment[0]!.dotPerType.slash ?? 0;
    near(tickBlade, tickBase, 1e-9); // 每跳不放大

    const stackBase = base.output.stacksPerType.slash ?? 0;
    const stackBlade = withBlade.output.stacksPerType.slash ?? 0;
    near(stackBlade, stackBase * mul); // 叠层放大
  });
});
