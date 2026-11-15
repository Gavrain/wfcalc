/**
 * 锁定射速 / 锁定多重：**判定只在乘区入口做一次**，各读法必然一致。
 *
 * 口径来源：
 *   · 锁射速：D-091 半自动炮轰系列「Fire Rate cannot be modified」；
 *   · 锁多重：`docs/decisions/core.md` D-182 敏锐主武 / 敏锐手枪「Multishot cannot be modified」。
 *
 * 两条规则同构：装上带标记的卡后，该属性的**所有**来源（正的和负的）都不生效，
 * 恒等于面板值。
 *
 * ⚠ 以前的 bug：`weapon-state.ts` 自己手工清空过快照、又过滤过 contributing 再喂乘区表，
 * 而伤害路径（`fireRateFinal()` / `multishot()`）拿的是原始 contribs。
 * 结果是「面板显示锁住了、连发秒伤却照样按 +150% 射速算」——
 * 装炮轰卡 + 射速卡，连发秒伤和无锁时一模一样。
 * 现在判定统一在 `buckets.ts` 的 `isStatLocked()` / `bucketDetail()`，以下断言钉住这点。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../src/index.ts';

const { compute } = core as any;

const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

/** 单模式、单段武器；`beam` 决定扳机（射线用 held） */
function makeWeapon(beam = false) {
  return {
    id: 'T', name: 'T',
    critChance: 0.2, critMultiplier: 2, statusChance: 0.3,
    fireRate: 5, magazineSize: 30, reloadTime: 2,
    modes: [{
      id: 'primary', role: 'normal', trigger: beam ? 'held' : 'auto', multishot: 1,
      variants: [{
        id: 'direct', label: '直接命中',
        segments: [{ kind: 'body', damage: { slash: 100 } }],
      }],
    }],
  };
}

/** 一条贡献；`extra` 用来挂锁标记（标记挂在任意一条贡献上，不限于被锁的属性） */
function contrib(stat: core.ContribStat, amount: number, extra: Record<string, unknown> = {}): core.Contribution {
  return { stat, form: 'pct', amount, source: 'x', slot: 0, ...extra } as core.Contribution;
}

const OPTS = { beam: false, faction: 'none', coStacks: 0, coStatusTypes: 0 };
const line = (r: any, id: string): number => r.output.lines.find((l: any) => l.id === id).value;

describe('锁射速（D-091）', () => {
  const weapon = makeWeapon();
  const run = (c: any[]) => compute(weapon, weapon.modes[0], c, OPTS);

  it('装上炮轰卡后，射速 Mod 不再提升射速（贡献按 0 计）', () => {
    const base = run([contrib('baseDamage', 240)]);
    const locked = run([contrib('baseDamage', 240, { locksFireRate: true }), contrib('fireRate', 150)]);
    const unlocked = run([contrib('baseDamage', 240), contrib('fireRate', 150)]);

    // 无锁：5 → 12.5
    near(unlocked.panelPairs.fireRate.after, 12.5, 1e-9);
    // 有锁：恒为面板 5
    near(locked.panelPairs.fireRate.after, base.panelPairs.fireRate.after, 1e-9);
    near(locked.panelPairs.fireRate.after, 5, 1e-9);
  });

  it('面板显示的射速 = 真正拿去算伤害的射速（两边不许各算各的）', () => {
    const r = run([contrib('baseDamage', 240, { locksFireRate: true }), contrib('fireRate', 150)]);
    const realFireRate = line(r, 'hitDps') / line(r, 'perShot');
    near(r.panelPairs.fireRate.after, realFireRate, 1e-9);
  });

  it('装上炮轰卡 + 射速卡，连发秒伤与「没装射速卡」完全相同', () => {
    const base = run([contrib('baseDamage', 240)]);
    const lockedWithRate = run([contrib('baseDamage', 240, { locksFireRate: true }), contrib('fireRate', 150)]);
    near(line(lockedWithRate, 'hitDps'), line(base, 'hitDps'), 1e-9);
  });

  it('负射速词条同样被锁（"正的和负的都不生效"）', () => {
    const base = run([contrib('baseDamage', 240)]);
    const r = run([contrib('baseDamage', 240, { locksFireRate: true }), contrib('fireRate', -100)]);
    near(r.panelPairs.fireRate.after, base.panelPairs.fireRate.after, 1e-9);
  });

  it('射线额外乘的那份多重不受锁射速影响', () => {
    const beamW = makeWeapon(true);
    const c = [contrib('baseDamage', 240, { locksFireRate: true }), contrib('multishot', 120)];
    const r = compute(beamW, beamW.modes[0], c, OPTS);
    near(r.panelPairs.multishot.after, 2.2, 1e-9);
  });
});

describe('锁多重（D-182）', () => {
  const weapon = makeWeapon();
  const run = (c: any[]) => compute(weapon, weapon.modes[0], c, OPTS);

  it('装上敏锐卡后，多重 Mod 不再提升多重（贡献按 0 计）', () => {
    const base = run([contrib('baseDamage', 240)]);
    const locked = run([contrib('baseDamage', 240, { locksMultishot: true }), contrib('multishot', 120)]);
    const unlocked = run([contrib('baseDamage', 240), contrib('multishot', 120)]);

    near(unlocked.panelPairs.multishot.after, 2.2, 1e-9);
    near(locked.panelPairs.multishot.after, base.panelPairs.multishot.after, 1e-9);
    near(locked.panelPairs.multishot.after, 1, 1e-9);
  });

  it('面板显示的多重 = 真正拿去算伤害的多重', () => {
    const r = run([contrib('baseDamage', 240, { locksMultishot: true }), contrib('multishot', 120)]);
    const realMs = line(r, 'perShot') / line(r, 'pelletPerHit');
    near(r.panelPairs.multishot.after, realMs, 1e-9);
  });

  it('射线武器上也生效（射线"再乘一次多重"走认锁后的值）', () => {
    const beamW = makeWeapon(true);
    const beamRun = (c: any[]) => compute(beamW, beamW.modes[0], c, OPTS);
    const base = beamRun([contrib('baseDamage', 240)]);
    const locked = beamRun([contrib('baseDamage', 240, { locksMultishot: true }), contrib('multishot', 120)]);
    const unlocked = beamRun([contrib('baseDamage', 240), contrib('multishot', 120)]);

    // 射线：多重已并进单弹头/DoT，触发率也乘一次 → 无锁时异常口径应上升
    assert.ok(line(unlocked, 'dotPerSecond') > line(base, 'dotPerSecond'));
    // 有锁：与不装多重卡完全一致
    near(line(locked, 'dotPerSecond'), line(base, 'dotPerSecond'), 1e-9);
    near(locked.panelPairs.multishot.after, 1, 1e-9);
  });

  it('射线分支保留：无锁时多重仍并进单弹头与 DoT', () => {
    const beamW = makeWeapon(true);
    const a = compute(beamW, beamW.modes[0], [contrib('baseDamage', 240)], OPTS);
    const b = compute(beamW, beamW.modes[0], [contrib('baseDamage', 240), contrib('multishot', 90)], OPTS);
    near(b.output.perShot / a.output.perShot, 1.9, 1e-9);
    near(b.segments[0].line.average / a.segments[0].line.average, 1.9, 1e-9);
  });
});

describe('锁判定只在乘区入口做一次', () => {
  it('isStatLocked 对射速 / 多重各认自己的标记，其它属性不认', () => {
    const lockedRate = [contrib('fireRate', 100, { locksFireRate: true })];
    const lockedMs = [contrib('multishot', 100, { locksMultishot: true })];
    assert.equal(core.isStatLocked('fireRate', lockedRate), true);
    assert.equal(core.isStatLocked('multishot', lockedRate), false);
    assert.equal(core.isStatLocked('multishot', lockedMs), true);
    assert.equal(core.isStatLocked('critChance', lockedMs), false);
  });

  it('锁只作用于本属性：锁射速时多重 Mod 照常生效，反之亦然', () => {
    const rate = [contrib('multishot', 120, { locksFireRate: true })];
    near(core.bucket(1, 'multishot', rate), 2.2, 1e-9);
    const ms = [contrib('fireRate', 150, { locksMultishot: true })];
    near(core.bucket(5, 'fireRate', ms), 12.5, 1e-9);
  });

  it('bucketDetail 的拆解明细与最终值一致：锁定时 pct/flat/mul 全按 0/1 计', () => {
    const c = [contrib('fireRate', 150, { locksFireRate: true })];
    const d = core.bucketDetail(5, 'fireRate', c);
    near(d.pct, 0);
    near(d.flat, 0);
    near(d.mul, 1);
    near(d.value, 5);
    assert.equal(d.contributors.length, 0);
  });
});
