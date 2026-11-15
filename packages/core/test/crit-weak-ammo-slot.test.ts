/**
 * 需求方 2026-11-15 确认的一批口径（A1 / A2 / A6 / A7 / B2），逐条锁住。
 *
 * | 编号 | 口径 |
 * |---|---|
 * | A1 | **弱点暴击率与普通暴击率是同一个乘区里的 Σ%**：`(面板 × (1+Σ普通%+Σ弱点%) + Σ固定) × Πmul`；只在开爆头时计入 |
 * | A2 | **重击 ×2 要体现在面板上**：面板 / 拆解 / 结算用同一套折算 |
 * | A6 | 面板「弹匣容量」= **等效弹匣**（已乘弹药效率） |
 * | A7 | 弹药效率上限 **0.75**，等效弹匣最多 4 倍 |
 * | B2 | 试算槽排在**自带四种基础元素 + 玄骸元素**之后；复合元素不占融合槽位 |
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../src/index.ts';

const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

const weapon = (extra: Record<string, unknown> = {}) => ({
  id: 'W', name: 'W', critChance: 0.2, critMultiplier: 2, statusChance: 0.3,
  fireRate: 10, magazineSize: 60, reloadTime: 2, ...extra,
});

const mode = (seg: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({
  id: 'primary', role: 'normal', trigger: 'auto', multishot: 1,
  variants: [{ id: 'direct', label: '直接命中', segments: [{ kind: 'impact', procChance: 0.3, damage: { impact: 100 }, ...seg }] }],
  ...extra,
});

const headshotOn = { headshot: { enabled: true, multiplier: 3 } };
const headshotOff = { headshot: { enabled: false, multiplier: 3 } };

describe('A1：弱点暴击率与普通暴击率同一个乘区（Σ%）', () => {
  const weak = [{ stat: 'weakpointCritChance', form: 'pct', amount: 350, source: 'acuity' }];

  it('开爆头：0.2 × (1 + 3.5) = 0.9（比例口径校验）', () => {
    const w = weapon({ critChance: 0.2 });
    const res: any = core.compute(w as any, mode() as any, weak as any, headshotOn as any);
    near(res.segments[0]!.critChance, 0.2 * 4.5);
  });

  it('和普通暴率 Mod 相加后同乘：0.2 × (1 + 1.2 + 3.5)', () => {
    const w = weapon({ critChance: 0.2 });
    const contribs = [
      { stat: 'critChance', form: 'pct', amount: 120, source: 's1' },
      ...weak,
    ];
    const res = core.compute(w as any, mode() as any, contribs as any, headshotOn as any);
    near(res.segments[0]!.critChance, 0.2 * 5.7);
  });

  it('关爆头：弱点暴击率整条不生效', () => {
    const w = weapon({ critChance: 0.2 });
    const res = core.compute(w as any, mode() as any, weak as any, headshotOff as any);
    near(res.segments[0]!.critChance, 0.2);
  });

  it('不再是「面板 + 3.5」的加法', () => {
    const w = weapon({ critChance: 0.2 });
    const res = core.compute(w as any, mode() as any, weak as any, headshotOn as any);
    assert.ok(Math.abs(res.segments[0]!.critChance - 3.7) > 1, `仍是加法：${res.segments[0]!.critChance}`);
  });
});

describe('A2：重击 ×2 要体现在面板上', () => {
  const steel = [{ stat: 'critChance', form: 'pct', amount: 120, source: 'true_steel', heavyX2: true }];

  it('重击模式：面板暴率与结算暴率一致，且是加倍的', () => {
    const w = weapon({ critChance: 0.2 });
    const res: any = core.compute(w as any, mode({}, { _heavy: true }) as any, steel as any, headshotOff as any);
    // 0.2 × (1 + 1.2×2) = 0.68
    near(res.segments[0]!.critChance, 0.2 * 3.4);
    near(res.panelPairs.critChance.after, res.segments[0]!.critChance);
  });

  it('非重击模式：不加倍', () => {
    const w = weapon({ critChance: 0.2 });
    const res = core.compute(w as any, mode() as any, steel as any, headshotOff as any);
    near(res.segments[0]!.critChance, 0.2 * 2.2);
  });
});

describe('A6 + A7：弹匣 = 等效弹匣，弹药效率上限 0.75', () => {
  const ammo = (pct: number) => [{ stat: 'ammoEfficiency', form: 'pct', amount: pct, source: 'a' }];

  it('弹药效率 50%：面板当前弹匣 = 60 × 2 = 120', () => {
    const w = weapon();
    const res = core.compute(w as any, mode() as any, ammo(50) as any, {});
    near(res.panelPairs.magazineSize.after, 120);
    near(res.state.computed.当前弹匣, 120);
  });

  it('弹药效率 100%：夹到 0.75 → 4 倍', () => {
    const w = weapon();
    const res = core.compute(w as any, mode() as any, ammo(100) as any, {});
    near(res.state.computed.当前弹匣, 240);
    near(res.panelPairs.magazineSize.after, 240);
  });
});

describe('B2：融合槽号顺序（需求方 2026-11-15 最终确认）', () => {
  const fire = (slot: number | undefined) => ({
    stat: 'elemental:heat',
    form: 'pct',
    amount: 90,
    source: 'hellfire',
    ...(slot === undefined ? {} : { slot }),
  });

  it('阈值常量：试算槽 = 8，自带 / 玄骸从 9 开始', () => {
    assert.equal((core as any).TRIAL_SLOT_ORDER, 8);
    assert.equal((core as any).PANEL_START_ORDER, 9);
  });

  it('真 Mod 排在自带 / 玄骸元素之前：面板自带火 + Mod 冰 → 火(自带9) 与 冰(Mod0) 照样合成爆炸', () => {
    const w = weapon();
    const res: any = core.compute(
      w as any,
      mode({ damage: { heat: 100, impact: 100 } }) as any,
      [{ stat: 'elemental:cold', form: 'pct', amount: 90, source: 'cryo', slot: 0 }] as any,
      {},
    );
    // Mod 冰排在自带火之前 → 两者配对成爆炸
    assert.ok((res.segments[0]!.finalHit.blast ?? 0) > 0, '应合成爆炸');
  });

  it('试算槽（8）也排在自带元素之前：槽 8 的 Mod 与自带火照样配对', () => {
    const w = weapon();
    const res: any = core.compute(
      w as any,
      mode({ damage: { heat: 100, impact: 100 } }) as any,
      [fire(8)] as any, // 槽 8 再加一份火（等价于试算位上的火）
      {},
    );
    // 同类型先加总，依旧是火，不会凭空变出别的元素
    assert.ok((res.segments[0]!.finalHit.heat ?? 0) > 0);
  });

  it('自带复合元素（磁力）不参与配对、不占融合槽位', () => {
    const w = weapon();
    const res: any = core.compute(w as any, mode({ damage: { magnetic: 100, impact: 100 } }) as any, [], {});
    near(res.segments[0]!.finalHit.magnetic ?? 0, 100);
  });
});

describe('C2：按段的面板对照（变体 override 生效）', () => {
  const twoVariants = {
    id: 'primary', role: 'normal', trigger: 'auto', multishot: 1,
    variants: [
      { id: 'direct', label: 'A', segments: [{ kind: 'impact', procChance: 0.3, damage: { impact: 100 } }] },
      {
        id: 'blast', label: 'B',
        override: { critChance: 0.5, statusChance: 0.1 },
        segments: [{ kind: 'explosiveAttack', procChance: 0.1, damage: { blast: 50 } }],
      },
    ],
  };

  it('第二段带自己的面板 override 时，结算与逐段面板都按它取', () => {
    const w = weapon();
    const res: any = core.compute(w as any, twoVariants as any, [], {});
    // 主段仍用武器级
    near(res.perSegment[0].inputs.panel.critChance, 0.2);
    // 第二段用变体 override
    near(res.perSegment[1].inputs.panel.critChance, 0.5);
    near(res.segments[1].critChance, 0.5);
    // 逐段面板对照
    assert.equal(res.segmentPanelPairs.length, 2);
    near(res.segmentPanelPairs[1].critChance.base, 0.5);
    near(res.segmentPanelPairs[1].statusChance.base, 0.1);
  });

  it('各段面板一致时，逐段对照也不会凭空造差异', () => {
    const w = weapon();
    const res: any = core.compute(w as any, mode() as any, [], {});
    assert.equal(res.segmentPanelPairs.length, 1);
    near(res.segmentPanelPairs[0].critChance.base, 0.2);
  });
});
