/**
 * D-155：同定暴击率词条在**重击系**攻击上 ×2。
 *
 * 需求方 2026-11-13：
 * > 「近战的同定暴击率词条例如斩铁或者裂罅mod上都会带有重击时*2，对重击和重型震地生效。」
 *
 * 口径（本条确认的细节）：
 *   · 只放大**这部分贡献**——面板自带暴率不乘；
 *   · 同张卡上的其它属性（暴伤 / 派系伤害）不乘，只认 `critChance` 上的 `heavyX2`；
 *   · 模式不是重击系（`_heavy` 不在）时完全不变。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { critChanceTotal } from '../src/crit.ts';
import type { AttackMode, Weapon } from '../src/weapon.ts';
import type { Contribution } from '../src/contributions.ts';

const near = (a: number, b: number, eps = 1e-9): void =>
  assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

/** 面板暴率 40% 的近战武器 */
const weapon = {
  id: 'TestMelee',
  name: 'Test Melee',
  category: 'melee',
  critChance: 0.4,
  critMultiplier: 3.2,
  statusChance: 0.2,
  fireRate: 1,
  modes: [],
} as unknown as Weapon;

const mode = (heavy: boolean): AttackMode =>
  ({
    id: heavy ? 'heavy' : 'primary',
    role: 'normal',
    trigger: 'unknown',
    bullets: 1,
    multishot: 1,
    variants: [],
    ...(heavy ? { _heavy: true } : {}),
  }) as AttackMode;

/** 斩铁满级 +120% 暴率（带 heavyX2） */
const trueSteel: Contribution = {
  stat: 'critChance',
  form: 'pct',
  amount: 120,
  source: 'true_steel',
  heavyX2: true,
};

/** 普通暴率加成（不带 heavyX2） */
const plain: Contribution = {
  stat: 'critChance',
  form: 'pct',
  amount: 100,
  source: 'some_mod',
};

describe('重击系攻击：固定暴击率词条 ×2（D-155）', () => {
  it('普攻模式不变：40% × (1+120%) = 88%', () => {
    near(critChanceTotal(weapon, [trueSteel], mode(false)), 0.88);
  });

  it('重型震地：只有斩铁那部分翻倍 → 40% × (1+240%) = 136%', () => {
    near(critChanceTotal(weapon, [trueSteel], mode(true)), 1.36);
  });

  it('面板与其它暴率 Mod 不参与翻倍：40% × (1+240%+100%) = 176%', () => {
    near(critChanceTotal(weapon, [trueSteel, plain], mode(true)), 1.76);
  });

  it('没有 heavyX2 贡献时，重击模式的暴率与普攻完全一致', () => {
    near(critChanceTotal(weapon, [plain], mode(true)), critChanceTotal(weapon, [plain], mode(false)));
  });

  it('暴伤词条即使误带标记也不影响暴率', () => {
    const cd = { ...trueSteel, stat: 'critMultiplier' as const };
    near(critChanceTotal(weapon, [cd as Contribution], mode(true)), critChanceTotal(weapon, [], mode(true)));
  });

  it('两张斩铁类词条各自翻倍：40% × (1+240%+440%)', () => {
    const sacrificial: Contribution = { ...trueSteel, amount: 220, source: 'sacrificial_steel' };
    near(critChanceTotal(weapon, [trueSteel, sacrificial], mode(true)), 0.4 * (1 + (1.2 + 2.2) * 2));
  });
});
