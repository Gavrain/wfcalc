/**
 * D-171：窗口从写死的 6 秒改成可选的 N 秒（1~6），并新增「N 秒总伤」。
 *
 *   ① 窗口秒数经 `CtxOptions.dotWindowSeconds` 传进来，归一到 1~6；
 *   ② 「N 秒异常总伤」= 逐秒曲线累加到第 N 秒（电击/毒气的第 0 拍仍在）；
 *   ③ 「N 秒总伤」= 续航秒伤 × N + N 秒异常总伤；
 *   ④ 爆炸**主目标**只按窗口内叠上的层数结算，不看 10 层上限、不看 1.5 秒延迟；
 *      范围伤害单列、不进任何总伤。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../src/index.ts';

const { compute, dotSixSecondCurve, normalizeDotWindowSeconds, stacksInWindow, windowLabel } = core as any;

const near = (a: number, b: number, eps = 1e-6) =>
  assert.ok(Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < eps, `${a} != ${b}`);
const lineOf = (res: any, id: string) => res.output.lines.find((l: any) => l.id === id);

/**
 * 测试枪：射速 10、弹匣 300（30 秒才打空 → 窗口内全程开火，排除装填空窗的干扰）。
 * 面板 100 冲击、触发率 50%。
 */
const rifle: any = {
  id: 'D171Rifle', name: 'D171',
  critChance: 0, critMultiplier: 2, statusChance: 0.5,
  fireRate: 10, magazineSize: 300, reloadTime: 2,
  modes: [{
    id: 'primary', role: 'normal', trigger: 'auto', multishot: 1,
    variants: [{ id: 'direct', label: '直接命中', segments: [{ kind: 'impact', procChance: 0.5, damage: { impact: 100 } }] }],
  }],
};

const heat: any = { stat: 'elemental:heat', form: 'pct', amount: 90, source: 'hellfire' };
const cold: any = { stat: 'elemental:cold', form: 'pct', amount: 90, source: 'cryo' };
const electric: any = { stat: 'elemental:electric', form: 'pct', amount: 90, source: 'stormbringer' };
const toxin: any = { stat: 'elemental:toxin', form: 'pct', amount: 90, source: 'malignant' };

describe('D-171 窗口秒数归一', () => {
  it('缺省是 6 秒', () => {
    assert.equal(normalizeDotWindowSeconds(undefined), 6);
  });

  it('超出 1~6 的按边界夹住，小数取整', () => {
    assert.equal(normalizeDotWindowSeconds(0), 6, '0 非法 → 回退默认 6');
    assert.equal(normalizeDotWindowSeconds(-3), 6);
    assert.equal(normalizeDotWindowSeconds(99), 6, '超过上限 → 6');
    assert.equal(normalizeDotWindowSeconds(15), 6);
    assert.equal(normalizeDotWindowSeconds(3.4), 3);
    assert.equal(normalizeDotWindowSeconds(2), 2);
  });

  it('显示名一律用阿拉伯数字（需求方 2026-11-13「六改成 6」）', () => {
    assert.equal(windowLabel(6), '6秒');
    assert.equal(windowLabel(3), '3秒');
    assert.equal(windowLabel(1), '1秒');
  });
});

describe('D-171 选择秒数改变异常总伤的窗口', () => {
  it('窗口秒数越小，异常总伤越小', () => {
    const vals = [1, 2, 3, 4, 5, 6].map((n) => {
      const res = compute(rifle, rifle.modes[0], [heat], { dotWindowSeconds: n });
      return res.output.dot6s as number;
    });
    assert.ok(vals[0]! > 0, '单段切割应有 DoT');
    for (let i = 1; i < vals.length; i++) {
      assert.ok(vals[i]! > vals[i - 1]!, `第 ${i + 1} 个窗口应更大：${vals.join(' / ')}`);
    }
  });

  it('输出结果里带着窗口长度，行名跟着变', () => {
    const res3 = compute(rifle, rifle.modes[0], [], { dotWindowSeconds: 3 });
    assert.equal(res3.output.windowSeconds, 3);
    assert.equal(lineOf(res3, 'dot6s').label, '3秒异常总伤');
    assert.equal(lineOf(res3, 'totalInWindow').label, '3秒总伤');

    const res6 = compute(rifle, rifle.modes[0], [], {});
    assert.equal(res6.output.windowSeconds, 6);
    assert.equal(lineOf(res6, 'dot6s').label, '6秒异常总伤');
    assert.equal(lineOf(res6, 'totalInWindow').label, '6秒总伤');
  });

  // D-179（需求方 2026-11-13）：直击部分改走开火时间线，
  //   N 秒总伤 = 窗口内直击 + N 秒异常总伤，不再用「续航秒伤 × N」
  it('N 秒总伤 = 窗口内直击 + N 秒异常总伤', () => {
    for (const n of [1, 2, 3, 4, 5, 6]) {
      const res = compute(rifle, rifle.modes[0], [], { dotWindowSeconds: n });
      near(res.output.totalInWindow, res.output.directInWindow + res.output.dot6s);
      near(lineOf(res, 'totalInWindow').value, res.output.totalInWindow);
    }
  });

  it('结果含「N 秒总伤」与「稳态秒伤」两行，顺序在异常总伤之后', () => {
    const res = compute(rifle, rifle.modes[0], [], {});
    const ids = res.output.lines.map((l: any) => l.id);
    // 关键顺序：异常总伤 → 窗口总伤 → 稳态秒伤（震地两项排在其后，只在震地模式有值）
    assert.ok(ids.indexOf('dot6s') < ids.indexOf('totalInWindow'));
    assert.ok(ids.indexOf('totalInWindow') < ids.indexOf('steadyDps'));
    near(res.output.steadyDps, lineOf(res, 'steadyDps').value);
  });
});

describe('D-171 核验：0 秒出伤的异常（电击 / 毒气）', () => {
  // 电击/毒气的第 0 拍：层数取**单发期望层数**（已含多重、与射速无关），额外加在窗口之外（D-059）。
  // 窗口只有 1 秒时它照样在，所以是「首发一拍 + 第 1 秒那一拍」= 2 拍。

  it('电击：1 秒窗口 = 第 0 拍（首发层）+ 第 1 秒（首发+本秒叠层）', () => {
    const contribs = [electric];
    const res = compute(rifle, rifle.modes[0], contribs, { dotWindowSeconds: 1 });
    const seg: any = res.segments[0];
    const tick = seg.dotTicks.find((t: any) => t.type === 'electric');
    const perShot = core.stacksPerShot('electric', seg.finalHit, seg.procChance, contribs, 1);
    const perSec = perShot * 10; // 射速 10

    near(tick.tick, 95, 1e-9); // 每跳 = 50 基础 × (1 + 电击 90%)
    // 第 0 拍 = 首发层数；第 1 秒 = 场上层数（首发 + 本秒新增）——D-059 首发已记为已存在
    const expected = perShot * tick.tick /* 第 0 拍 */ + (perShot + perSec) * tick.tick /* 第 1 秒 */;
    near(res.output.dot6s, expected);
    near(res.output.dot6s, 270);
  });

  it('毒气：1 秒窗口同样含第 0 拍，且首发层数受 10 层上限约束', () => {
    // 火 + 毒 → 毒气
    const contribs = [heat, toxin];
    const res = compute(rifle, rifle.modes[0], contribs, { dotWindowSeconds: 1 });
    const seg: any = res.segments[0];
    const tick = seg.dotTicks.find((t: any) => t.type === 'gas');
    assert.ok((seg.finalHit.gas ?? 0) > 0, '火+毒应合成出毒气');

    const perShot = core.stacksPerShot('gas', seg.finalHit, seg.procChance, contribs, 1);
    const perSec = perShot * 10;
    const gasOnly = core.dotSixSecondCurve('gas', perSec, tick.tick, 1, () => 1, perShot);
    near(gasOnly, perShot * tick.tick + (perShot + perSec) * tick.tick);

    // 首发超过 10 层时，第 0 拍封顶在 10 层；第 1 秒没有新层，场上层数仍是 10 → 共 2 拍 × 10 层
    const huge = core.dotSixSecondCurve('gas', 0, 1, 1, () => 1, 50);
    near(huge, 20, 1e-9);
  });

  it('火焰 / 毒素没有第 0 拍：1 秒窗口只有 1 拍', () => {
    const contribs = [heat];
    const res = compute(rifle, rifle.modes[0], contribs, { dotWindowSeconds: 1 });
    const seg: any = res.segments[0];
    const tick = seg.dotTicks.find((t: any) => t.type === 'heat');
    const perShot = core.stacksPerShot('heat', seg.finalHit, seg.procChance, contribs, 1);
    const perSec = perShot * 10;
    // 火焰第 1 秒的累计层数 = 这一秒叠上的，没有"额外一拍"
    near(res.output.dot6s, perSec * tick.tick);
  });

  it('第 0 拍的层数与射速无关（用单发期望层数），第 1 秒起才乘射速', () => {
    const contribs = [electric];
    const slow: any = { ...rifle, fireRate: 5 };
    const fast: any = { ...rifle, fireRate: 10 };
    const a = compute(slow, slow.modes[0], contribs, { dotWindowSeconds: 1 });
    const b = compute(fast, fast.modes[0], contribs, { dotWindowSeconds: 1 });
    const tickA: any = a.segments[0].dotTicks.find((t: any) => t.type === 'electric');
    const tickB: any = b.segments[0].dotTicks.find((t: any) => t.type === 'electric');
    const perShot = core.stacksPerShot('electric', a.segments[0].finalHit, a.segments[0].procChance, contribs, 1);

    // 第 0 拍两边相同 = perShot 层；第 1 秒 = (首发 + 本秒新增)
    near(a.output.dot6s, perShot * tickA.tick + (perShot + perShot * 5) * tickA.tick);
    near(b.output.dot6s, perShot * tickB.tick + (perShot + perShot * 10) * tickB.tick);
    near(perShot * tickA.tick, perShot * tickB.tick);
  });
});

describe('D-171 核验：爆炸', () => {
  /** 火 + 冰 → 爆炸 */
  const blastMods = [heat, cold];

  it('爆炸主目标 = 窗口内叠上的层数 × 每层伤害（不看 10 层上限）', () => {
    const res = compute(rifle, rifle.modes[0], blastMods, { dotWindowSeconds: 1 });
    const b = res.output.blast as any;
    near(b.totalInWindow, b.perStack * b.stacksPerSecond * 1);
    const res3 = compute(rifle, rifle.modes[0], blastMods, { dotWindowSeconds: 3 });
    near(res3.output.blast.totalInWindow, b.perStack * b.stacksPerSecond * 3);
  });

  it('窗口内叠上的层数按开火占比算，装填期间不叠', () => {
    // 每秒叠层 1，第 1 秒只开火 75%，第 2 秒开火 50% → 窗口内 1.25 层
    const firing = (s: number) => (s === 1 ? 0.75 : 0.5);
    near(stacksInWindow(1, 2, firing), 1.25);
  });

  it('范围伤害不进异常总伤：总伤只由 DoT + 爆炸主目标构成', () => {
    // 触发率拉高（+500% 触发几率），让爆炸能在 1.5 秒内叠满 10 层
    const statusMod: any = { stat: 'statusChance', form: 'pct', amount: 500, source: 'status' };
    const mods = [statusMod, heat, cold];
    const res = compute(rifle, rifle.modes[0], mods, { dotWindowSeconds: 3 });
    const seg: any = res.segments[0];
    const present = new Set(Object.keys(seg.finalHit));
    let dotPart = 0;
    for (const t of seg.dotTicks) {
      if (!present.has(t.type)) continue;
      dotPart += core.dotSixSecondCurve(
        t.type, res.output.stacksPerType[t.type] ?? 0, t.tick, 3, () => 1,
        core.stacksPerShot(t.type, seg.finalHit, seg.procChance, mods, 1),
      );
    }
    near(res.output.dot6s, dotPart + res.output.blast.totalInWindow);
    assert.ok(res.output.blast.splashOnTrigger > 0, '这个配置应能触发范围伤害');
    assert.ok(res.output.blast.splashOnTrigger > res.output.blast.totalInWindow,
      '范围伤害远大于主目标，若被算进去总伤会离谱');
  });

  it('叠层快慢只决定"是否触发范围伤害"，不改变主目标每层系数', () => {
    const fast = compute(rifle, rifle.modes[0], blastMods, {});
    const b: any = fast.output.blast;
    const slowRifle: any = { ...rifle, statusChance: 0.25 };
    const slow = compute(slowRifle, slowRifle.modes[0], blastMods, {});
    near(slow.output.blast.perStack, b.perStack);
    near(slow.output.blast.perStackDetonated, b.perStackDetonated);
  });
});
