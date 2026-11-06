/**
 * 类镀层：只认冰冻层数的加成（D-086，需求方 2026-11-06）。
 *
 * 需求方原话：
 * > 「次要·冷颤是类镀层加成，但是只对冰冻层数生效。可以设置成直接给满层数的类镀层加成，
 * > 只有直接非灵化加成伤害才能享受。」
 *
 * 与普通镀层（`overForStacks`）的区别：
 *   · 普通镀层按**所有**异常状态的种类数 `a` 算；
 *   · 冷颤只按**冰冻**层数算，且**直接给满层**（`FROZEN_FULL_STACKS`）。
 * 共同点：都只吃直接伤害 → 不吃 AoE 段、不吃灵化模式。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FROZEN_FULL_STACKS, overForElement, overForStacks } from '../../core/src/weapon-state.ts';
import type { Contribution } from '../../core/src/contributions.ts';

const freeze = (pct: number): Contribution[] => [{ stat: 'coFreeze', form: 'pct', amount: pct, source: 'SecondaryExtraDamagePerFreezeStack' }];
const co = (pct: number): Contribution[] => [{ stat: 'co', form: 'pct', amount: pct, source: 'galvanized_aptitude' }];

describe('类镀层：只认冰冻层数（D-086）', () => {
  it('满层冰冻 = 10 层', () => {
    assert.equal(FROZEN_FULL_STACKS, 10);
  });

  it('冷颤满级 +45% / 层 → 满层 +450%', () => {
    // 45% × 10 层 = 4.5（450%）
    assert.equal(overForElement(freeze(45), 'coFreeze', FROZEN_FULL_STACKS), 4.5);
  });

  it('层数为 0 时不生效', () => {
    assert.equal(overForElement(freeze(45), 'coFreeze', 0), 0);
  });

  it('和普通镀层互不干扰：普通镀层不会读 coFreeze，冷颤也不会读 co', () => {
    const mixed = [...co(40), ...freeze(45)];
    // 普通镀层：40% × 2 层 × 3 种异常
    assert.equal(overForStacks(mixed, 2, 3), (40 / 100) * 3 * 2);
    // 冷颤：45% × 10 层
    assert.equal(overForElement(mixed, 'coFreeze', FROZEN_FULL_STACKS), 4.5);
  });

  it('没有冰冻加成时返回 0（不会把普通镀层加成算进来）', () => {
    assert.equal(overForElement(co(80), 'coFreeze', FROZEN_FULL_STACKS), 0);
  });

  it('按**配置里的层数**随动（不再是写死满层）', () => {
    // 每层 45%，层数 0→0、3→135%、6→270%、10→450%
    const cases: [number, number][] = [[0, 0], [3, 1.35], [6, 2.7], [10, 4.5]];
    for (const [stacks, expected] of cases) {
      assert.equal(overForElement(freeze(45), 'coFreeze', stacks), expected, `${stacks} 层`);
    }
  });
});

describe('冷颤固定按满层 10 层算，不读配置里的异况层数（D-087 澄清）', () => {
  it('配置的异况数变化不影响冷颤（core 里传的是常量 FROZEN_FULL_STACKS）', async () => {
    const ws = await import('../../core/src/weapon-state.ts');
    // 冷颤的加量恒为 每层值 × FROZEN_FULL_STACKS
    assert.equal(
      ws.overForElement(freeze(45), 'coFreeze', ws.FROZEN_FULL_STACKS),
      4.5,
      '满层 10 × 45% = 450%',
    );
    // 层数常量本身不随配置变化
    assert.equal(ws.FROZEN_FULL_STACKS, 10);
  });
});
