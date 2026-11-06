/**
 * 镀层类数据层规则测试（A-03 / D-024，2026-11-06 修订两次）：
 *   · 镀层 / 异况类基伤：**每层值 × 叠层上限**，加量 = 满层值 × 目标异常状态种类数；
 *   · 每张卡的每层值按 Mod 描述：异况超量 80×1、步枪才能 40×2、通晓霰弹枪 40×2、准确射手 30×3；
 *   · 异况超量 = 常驻生效（`conditions` 为空 → 1 层）；
 *   · 没有等级调节 UI，所以一律用满级/满层数值（需求方 2026-11-06）。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  arcaneStackCount,
  arcaneToContributions,
  conditionOverloadMaxStacks,
  isAlwaysOnConditionOverload,
  isConditionOverloadMod,
  modToContributions,
  type ArcaneRecord,
  type ModRecord,
} from '../src/adapter.ts';

const ROOT = normalize(join(fileURLToPath(new URL('.', import.meta.url)), '../../..'));

const mods = JSON.parse(await readFile(join(ROOT, 'packages/data/src/generated/mods/mods.json'), 'utf8')).mods as ModRecord[];
const byId = new Map<string, ModRecord>(mods.map((m) => [m.id, m]));
const arcanes = JSON.parse(await readFile(join(ROOT, 'packages/data/src/generated/mods/arcanes.json'), 'utf8')).arcanes as ArcaneRecord[];

/** 取已生成的 Mod 记录；缺失直接失败，避免把 `undefined` 传进断言函数 */
function mod(id: string): ModRecord {
  const record = byId.get(id);
  assert.ok(record, `mods.json 里没有 ${id}`);
  return record;
}

/** 某 Mod 的 `co` 满级值 */
function coMax(m: ModRecord): number {
  const s = m.stats.find((x) => x.key === 'co');
  assert.ok(s, `${m.id} 没有 co 属性`);
  return s.levelValues.at(-1)!;
}

/** 适配层输出的 co 单层贡献 */
function coContrib(m: ModRecord): number {
  const c = modToContributions(m).find((x) => x.stat === 'co');
  assert.ok(c, `${m.id} 没有生成 co 贡献`);
  return c.amount;
}

describe('镀层 / 异况类：数据层存**每层值**，内核再乘异况数与叠层上限（D-024 / D-081）', () => {
  it('每层值按 Mod 描述（不是满层值）', () => {
    assert.equal(coMax(mod('condition_overload')), 80); // 每层 80，叠层恒 1
    assert.equal(coMax(mod('galvanized_aptitude')), 40); // 每层 40
    assert.equal(coMax(mod('galvanized_savvy')), 40); // 每层 40
    assert.equal(coMax(mod('galvanized_shot')), 40); // 每层 40
  });

  it('满层加成 = 每层值 × 叠层上限（步枪才能 40×2=80、准确射手 40×3=120）', () => {
    const full = (id: string) => coMax(mod(id)) * (conditionOverloadMaxStacks(mod(id)) ?? 1);
    assert.equal(full('condition_overload'), 80);
    assert.equal(full('galvanized_aptitude'), 80);
    assert.equal(full('galvanized_savvy'), 80);
    assert.equal(full('galvanized_shot'), 120);
  });

  it('逐级是线性的（第 r 级 = 每层值 × r / 等级上限）', () => {
    const s = mod('galvanized_aptitude').stats.find((x) => x.key === 'co')!;
    assert.equal(s.levelValues.length, 11);
    assert.equal(s.levelValues[0], 0);
    assert.equal(s.levelValues[5], 20); // 满级 40 的一半
    assert.equal(s.levelValues[10], 40); // 每层值
  });

  it('适配层原样传递每层值（不再除/乘叠层上限，避免算两次）', () => {
    for (const id of ['galvanized_aptitude', 'galvanized_savvy', 'galvanized_shot']) {
      assert.equal(coContrib(mod(id)), coMax(mod(id)), `${id} 适配层不应改动每层值`);
    }
  });

  it('✦ 需求方口径：每层 40% × 3 异况 × 2 层 = 240%（步枪才能）', () => {
    const per = coContrib(mod('galvanized_aptitude')); // 40
    const a = 3; // 敌人异况数量
    const y = conditionOverloadMaxStacks(mod('galvanized_aptitude'))!; // 2
    // 浮点：40/100 × 3 × 2 = 2.4000000000000004
    assert.ok(Math.abs((per / 100) * a * y - 2.4) < 1e-9, `实际 ${(per / 100) * a * y}`);
  });

  it('异况超量：常驻型（conditions 为空 → 1 层）', () => {
    const m = mod('condition_overload');
    assert.ok(isConditionOverloadMod(m));
    assert.equal(isAlwaysOnConditionOverload(m), true);
    assert.equal(conditionOverloadMaxStacks(m), 1);
  });

  it('叠层上限仍从 conditions 读', () => {
    assert.equal(conditionOverloadMaxStacks(mod('galvanized_aptitude')), 2);
    assert.equal(conditionOverloadMaxStacks(mod('galvanized_shot')), 3);
    assert.equal(conditionOverloadMaxStacks(mod('galvanized_savvy')), 2);
  });

  it('普通 Mod（无 co 键）返回 null', () => {
    const m = mod('serration');
    assert.equal(isConditionOverloadMod(m), false);
    assert.equal(conditionOverloadMaxStacks(m), null);
  });
});

describe('满级 / 满层数值（没有等级调节 UI）', () => {
  it('幽灵膛线：满级 +330（每级 30）', () => {
    const m = mod('spectral_serration');
    const s = m.stats.find((x) => x.key === 'dmg')!;
    assert.equal(s.levelValues.at(-1), 330);
    assert.equal(s.levelValues[1], 30);
  });

  it('主要·无情：满层 360% 基伤（每层 30% × 12 层）', () => {
    const a = arcanes.find((x) => x.id === 'PrimaryDamageOnKill');
    assert.ok(a, 'arcanes.json 里没有主要·无情');
    assert.equal(arcaneStackCount(a), 12);
    const c = arcaneToContributions(a).find((x) => x.stat === 'baseDamage');
    assert.ok(c);
    assert.equal(c.amount, 360);
  });

  it('非叠层赋能原样取值（不被误乘）', () => {
    const plain = arcanes.find((a) => arcaneStackCount(a) === 1 && a.bucket === 'baseDamage');
    if (!plain) return; // 没有这类赋能时跳过
    const c = arcaneToContributions(plain).find((x) => x.stat === 'baseDamage');
    assert.ok(c);
  });
});

describe('剔除清单（需求方 2026-11-06）', () => {
  it('空中制霸（Aerial Ace）不收录：是战甲 Mod，不是武器 Mod', () => {
    assert.equal(byId.has('aerial_ace'), false);
  });

  it('幽灵膛线已被订正收录（不是剔除）', () => {
    assert.equal(byId.has('spectral_serration'), true);
  });
});
