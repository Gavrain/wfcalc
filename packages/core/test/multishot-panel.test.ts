/**
 * 面板多重乘区（回归测试）。
 *
 * bug 背景：`multishot()` 曾经从常量 `1` 起算
 *   `return 1 + sumPct(contribs, 'multishot')`
 * 完全忽略了 `mode.multishot`。57 把武器自带多重（Twin Rogga 15、Brakk 10、
 * Drakgoon 10、Boar 8…），于是它们的单次射击被低估了同样的倍数，
 * 且装多重 Mod 后也只按 Mod 的百分比算（15 × 1.9 = 28.5 被算成 1.9）。
 *
 * 口径：当前多重 = 面板多重 × (1 + Σ多重%) + Σ绝对值（表 2.0 骨架）
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { multishot } from '../src/main.ts';
import type { Weapon, AttackMode } from '../src/weapon.ts';
import type { Contribution } from '../src/contributions.ts';
import { modeWithSegments } from './_helpers.ts';

const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

function makeWeapon(ms: number): Weapon {
  return {
    id: 'TestShotgun',
    name: 'Test Shotgun',
    category: 'primary',
    critChance: 0.1,
    critMultiplier: 2,
    statusChance: 0.2,
    fireRate: 2,
    magazineSize: 5,
    reloadTime: 2,
    modes: [
      modeWithSegments(
        { id: 'primary', role: 'normal', trigger: 'auto', bullets: 1, multishot: ms },
        [{ kind: 'impact', aoe: false, procChance: 0.2, damage: { impact: 100 } }],
      ),
    ],
  };
}

const pct = (amount: number): Contribution => ({ stat: 'multishot', form: 'pct', amount, source: 'm' });
const flat = (amount: number): Contribution => ({ stat: 'multishot', form: 'flat', amount, source: 'f' });

function modeOf(w: Weapon): AttackMode {
  return w.modes[0]!;
}

describe('面板多重乘区', () => {
  it('面板多重 15、无 Mod → 当前多重 = 15（不是 1）', () => {
    const w = makeWeapon(15);
    near(multishot([], w, modeOf(w)), 15);
  });

  it('面板多重 15 + 90% 多重 Mod → 15 × 1.9 = 28.5', () => {
    const w = makeWeapon(15);
    near(multishot([pct(90)], w, modeOf(w)), 28.5);
  });

  it('面板多重 1 + 90% → 1.9（普通武器行为不变）', () => {
    const w = makeWeapon(1);
    near(multishot([pct(90)], w, modeOf(w)), 1.9);
  });

  it('绝对值加算：面板多重 5 + 2 点 → 7', () => {
    const w = makeWeapon(5);
    near(multishot([flat(2)], w, modeOf(w)), 7);
  });

  it('面板多重 5 + 50% + 2 点 → 5 × 1.5 + 2 = 9.5', () => {
    const w = makeWeapon(5);
    near(multishot([pct(50), flat(2)], w, modeOf(w)), 9.5);
  });

  it('多个多重 Mod 的百分比先相加：+30% 与 +60% → ×1.9', () => {
    const w = makeWeapon(10);
    near(multishot([pct(30), pct(60)], w, modeOf(w)), 19);
  });
});
