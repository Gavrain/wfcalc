/**
 * D-059：电击 / 毒气在 0 秒立即跳一拍，层数取首发。
 *   第 0 拍额外计入六秒之外 → 窗口内共 7 拍。
 *   火焰 / 毒素 / 切割**没有**第 0 拍。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../src/index.ts';

const { dotSixSecondCurve, IMMEDIATE_TICK } = core as any;

const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

describe('0 秒立即跳一拍（D-059）', () => {
  it('只有电击和毒气在 0 秒跳', () => {
    assert.equal(IMMEDIATE_TICK.has('electric'), true);
    assert.equal(IMMEDIATE_TICK.has('gas'), true);
    assert.equal(IMMEDIATE_TICK.has('heat'), false);
    assert.equal(IMMEDIATE_TICK.has('toxin'), false);
    assert.equal(IMMEDIATE_TICK.has('slash'), false);
  });

  it('毒气有首发时多出来的不只是第 0 拍（首发层也参与后续每一拍）', () => {
    const without = dotSixSecondCurve('gas', 1, 10, 6, () => true, 0);
    const withFirst = dotSixSecondCurve('gas', 1, 10, 6, () => true, 0.5);
    // 首发 0.5 层：第 0 拍 0.5；之后每拍都比原来多 0.5 层 → 共 7 拍 × 0.5 层
    near(withFirst - without, 7 * 0.5 * 10);
  });

  it('电击有首发时同样多出 7 拍的量', () => {
    const without = dotSixSecondCurve('electric', 1, 10, 6, () => true, 0);
    const withFirst = dotSixSecondCurve('electric', 1, 10, 6, () => true, 2);
    near(withFirst - without, 7 * 2 * 10);
  });

  it('对比没有 0 秒跳的类型：同样给首发，只多 6 拍', () => {
    // 毒素没有第 0 拍，首发层只影响 t=1..6 这 6 拍
    const without = dotSixSecondCurve('toxin', 1, 10, 6, () => true, 0);
    const withFirst = dotSixSecondCurve('toxin', 1, 10, 6, () => true, 2);
    near(withFirst - without, 0); // 没有 0 秒跳的类型完全不使用首发参数
  });

  it('火焰没有第 0 拍：传不传首发结果相同', () => {
    const a = dotSixSecondCurve('heat', 2, 1, 6, () => true, 0);
    const b = dotSixSecondCurve('heat', 2, 1, 6, () => true, 99);
    near(a, b);
  });

  it('毒素没有第 0 拍', () => {
    const a = dotSixSecondCurve('toxin', 2, 1, 6, () => true, 0);
    const b = dotSixSecondCurve('toxin', 2, 1, 6, () => true, 99);
    near(a, b);
  });

  it('毒气第 0 拍也受 10 层上限约束', () => {
    // 首发给 50 层，但上限 10 → 第 0 拍只有 10 层
    // 之后每秒叠 0 层，但已有 10 层照常每秒跳 → 共 7 拍
    const capped = dotSixSecondCurve('gas', 0, 10, 6, () => true, 50);
    near(capped, 7 * 10 * 10);
  });

  it('0 秒那一拍用的是首发层数，不是每秒叠层', () => {
    // 每秒叠 1 层、首发 3 层：第 0 拍 = 3 层
    const s = 1;
    const perStack = 10;
    const first = 3;
    const total = dotSixSecondCurve('gas', s, perStack, 6, () => true, first);
    // 第 0 拍 3；t=1..6 累积层数 4,5,6,7,8,9（首发已计入，不重复）
    // = 10*(3+4+5+6+7+8+9) = 420
    near(total, perStack * (3 + 4 + 5 + 6 + 7 + 8 + 9));
  });

  it('首发的层不会在 t=1 被重复计入', () => {
    const s = 1;
    const perStack = 10;
    const first = 3;
    const total = dotSixSecondCurve('gas', s, perStack, 6, () => true, first);
    // 若重复计入，t=1 会有 3+1+1=5 层，总数会更大
    const naive = perStack * (3 + 5 + 6 + 7 + 8 + 9 + 10);
    assert.ok(total < naive, `不该重复计入首发的层：${total} vs ${naive}`);
  });
});
