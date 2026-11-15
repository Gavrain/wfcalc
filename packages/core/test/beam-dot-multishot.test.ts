/**
 * 射线武器的多重进 DoT 基础值（需求方 2026-11-12 确认）。
 *
 * 需求方原话：
 *   「我说的是对射线的 dot 每跳生效」
 *   「就是合成一跳啊，而且是乘了多重 mod 的合成一跳。」
 *
 * 口径（`docs/乘区归属表.md` 表 0.1 / §0.3 / §6.2 ①）：
 * ```
 * 射线类的单弹头伤害 = 基础伤害项 × (1 + Σ多重Mod%)，与单次射击相同
 * → 射线的 DoT 基础值里**已含多重**（多条激光打同一目标合并成一跳）
 * → 实弹的 DoT 基础值不含多重（多重只影响叠几层）
 * ```
 *
 * 以前 `segment.ts` 的 `dotBase` / `tickBaseScaled` 完全没乘多重，台账写了但代码没做。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../src/index.ts';

const { compute } = core as any;
const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

/** 一把单模式武器；`beamSeg` 控制该段是否是射线 */
function makeWeapon(trigger: string, beamSeg?: boolean) {
  const seg: any = { kind: 'attack', aoe: false, procChance: 0.5, damage: { slash: 100 } };
  if (beamSeg !== undefined) seg.beam = beamSeg;
  return {
    id: 'T', name: 'T',
    critChance: 0, critMultiplier: 1, statusChance: 0.5,
    fireRate: 10, magazineSize: 100, reloadTime: 1,
    modes: [{
      id: 'primary', role: 'normal', trigger, multishot: 1,
      variants: [{ id: 'direct', label: '直接命中', segments: [seg] }],
    }],
  };
}

const MS = [{ stat: 'multishot', form: 'pct', amount: 90, source: 'split' }];
const MS_FLAT = [{ stat: 'multishot', form: 'flat', amount: 1, source: 'x' }];

const slashTick = (r: any): number => r.segments[0].dotTicks.find((t: any) => t.type === 'slash').tick;

describe('射线 DoT 每跳吃多重（需求方 2026-11-12）', () => {
  it('射线（扳机 held）：+90% 多重让每跳 ×1.9', () => {
    const w = makeWeapon('held');
    const a = compute(w, w.modes[0], []);
    const b = compute(w, w.modes[0], MS);
    assert.equal(a.segments[0].beam, true);
    near(slashTick(b) / slashTick(a), 1.9, 1e-9);
  });

  it('射线：绝对加算的多重也进每跳', () => {
    const w = makeWeapon('held');
    const a = compute(w, w.modes[0], []);
    const b = compute(w, w.modes[0], MS_FLAT);
    near(slashTick(b) / slashTick(a), 2, 1e-9);
  });

  it('实弹（扳机 auto）：多重**不进**每跳，只影响叠层', () => {
    const w = makeWeapon('auto');
    const a = compute(w, w.modes[0], []);
    const b = compute(w, w.modes[0], MS);
    assert.equal(a.segments[0].beam, false);
    near(slashTick(b), slashTick(a));
    // 层数（每秒）确实变多
    assert.ok((b.output.stacksPerType.slash ?? 0) > (a.output.stacksPerType.slash ?? 0));
  });

  it('射线：命中「单弹头」与 DoT 基础值同源，都吃一次多重（不重复乘）', () => {
    const w = makeWeapon('held');
    const a = compute(w, w.modes[0], []);
    const b = compute(w, w.modes[0], MS);
    // 单次射击 = 单弹头 × 多重；单弹头本身已含多重 → 总比值 1.9，而不是 1.9²
    near(b.output.perShot / a.output.perShot, 1.9, 1e-9);
    near(b.segments[0].line.average / a.segments[0].line.average, 1.9, 1e-9);
    // 射线的「单弹头」与「单次射击」相等（多重已并进单弹头）——这是表 0.1 的定义
    near(b.output.pelletPerHit / b.output.perShot, 1, 1e-9);
  });

  it('射线：面板自带多重 > 1 时，每跳也按当前多重算（面板 × (1+Σ%)）', () => {
    const w = makeWeapon('held');
    w.modes[0]!.multishot = 2;
    const a = compute(w, w.modes[0], []);
    const b = compute(w, w.modes[0], MS);
    // 当前多重 2 → 2 × 1.9 = 3.8；比值仍是 1.9
    near(a.panelPairs.multishot.base, 2);
    near(b.panelPairs.multishot.after, 3.8, 1e-9);
    near(slashTick(b) / slashTick(a), 1.9, 1e-9);
  });
});

describe('射线按段判定（需求方 2026-11-12）', () => {
  it('模式扳机是 held，但段写了 beam=false → 该段按实弹算，不吃多重', () => {
    const w = makeWeapon('held', false);
    const a = compute(w, w.modes[0], []);
    const b = compute(w, w.modes[0], MS);
    assert.equal(a.segments[0].beam, false);
    near(slashTick(b), slashTick(a));
  });

  it('段没写 beam → 跟随模式扳机', () => {
    const held = makeWeapon('held');
    const auto = makeWeapon('auto');
    assert.equal(compute(held, held.modes[0], []).segments[0].beam, true);
    assert.equal(compute(auto, auto.modes[0], []).segments[0].beam, false);
  });

  it('同一模式混合时，逐段各算各的', () => {
    const w: any = makeWeapon('held');
    w.modes[0].variants[0].segments = [
      { kind: 'attack', aoe: false, procChance: 0.5, damage: { slash: 100 } },            // 未写 → 射线
      { kind: 'attack', aoe: false, procChance: 0.5, damage: { slash: 100 }, beam: false }, // 明确实弹
    ];
    const r = compute(w, w.modes[0], []);
    assert.equal(r.segments[0].beam, true);
    assert.equal(r.segments[1].beam, false);
  });
});

describe('多重只影响叠层，不影响触发率本身（需求方 2026-11-14，D-195）', () => {
  it('显示的触发率不随多重变化，且不再有 beam 分支', () => {
    // 游戏内显示的触发率 = 面板触发率 × (1 + Σ触发率%)，不含多重；
    // `totalProcChance()` 已没有 beam 参数——射线与实弹同一条公式
    near(core.totalProcChance(0.39, []), 0.39);
    near(core.totalProcChance(0.39, [] as any), 0.39, 1e-9);
  });

  it('射线与实弹的叠层统一乘多重（stacksPerShot 不再按 beam 分支）', () => {
    const v = { toxin: 100 };
    const c = [{ stat: 'statusChance', form: 'pct', amount: 120, source: 'x', slot: 0 }] as any;
    for (const ms of [1, 1.9, 3.8, 15]) {
      const stacks = core.stacksPerShot('toxin', v, 0.39, c, ms);
      // 与「触发率 × 占比 × 多重」一致
      near(stacks, core.totalProcChance(0.39, c) * core.share('toxin', v) * ms, 1e-9);
    }
  });

  it('射线 DoT 叠层随多重线性上升（等价于旧的"多重进触发率"）', () => {
    const w = makeWeapon('held');
    const one = compute(w, w.modes[0], []);
    const two = compute(w, w.modes[0], MS);
    // +90% 多重 → 叠层 ×1.9
    near(two.output.stacksPerType.slash / one.output.stacksPerType.slash, 1.9, 1e-9);
    // 每跳基础值也同样 ×1.9（射线的多重并进伤害，这条没变）
    near(slashTick(two) / slashTick(one), 1.9, 1e-9);
  });
});
