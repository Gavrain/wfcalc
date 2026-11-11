/**
 * 面板变体隔离（D-096，需求方 2026-11-06）。
 *
 * 反馈：
 * > 「basmu 不上 mod 为什么会当前面板跟基础不一样，巴兹火枪好像两个面板也混同了。」
 *
 * 根因：`compute().totalSpread` 是**所有变体所有段**之和（命中 + 爆炸），
 * 而 UI 的"基础"列取的是**当前变体**的段。两者并列就把两个面板混成了一个：
 * ```
 * 巴什穆 blast 变体：基础 heat19+electric12=31  vs  当前 totalSpread=98（含命中段）
 * 巴兹火枪 blast：基础 blast40           vs  当前 175（含命中段）
 * ```
 * 修复：`compute()` 新增 `spreadByVariant[]`，UI 按变体取。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compute } from '../../core/src/index.ts';
import type { AttackMode, DamageSegment, Weapon } from '../../core/src/weapon.ts';

const ROOT = normalize(join(fileURLToPath(new URL('.', import.meta.url)), '../../..'));

async function loadAllWeapons(): Promise<Weapon[]> {
  const out: Weapon[] = [];
  for (const f of ['primary', 'secondary', 'melee', 'archgun', 'archmelee']) {
    const d = JSON.parse(await readFile(join(ROOT, `packages/data/src/generated/weapons/${f}.json`), 'utf8'));
    out.push(...(d.weapons as Weapon[]));
  }
  return out;
}

function sumSpread(s: Record<string, number> | Partial<Record<string, number>>): number {
  return Object.values(s).reduce((a: number, b) => a + (b ?? 0), 0);
}

function baseOf(variant: { segments: readonly DamageSegment[] }): Record<string, number> {
  const out: Record<string, number> = {};
  for (const seg of variant.segments) {
    for (const [t, v] of Object.entries(seg.damage) as [string, number | undefined][]) {
      if (typeof v === 'number' && v !== 0) out[t] = (out[t] ?? 0) + v;
    }
  }
  return out;
}

describe('多变体武器：无 Mod 时「当前」必须等于「基础」', () => {
  it('巴什穆（Basmu）：每种攻击方式单独算时「当前」等于它自己各段之和', async () => {
    const all = await loadAllWeapons();
    const w = all.find((x) => x.id === 'SentRifleNewWarGun');
    assert.ok(w, '找不到巴什穆');
    // D-148 + 需求方 2026-11-12：一个模式内可以有多种「攻击方式」（命中 / 爆炸），
    //   界面用复选框选哪些参与计算。所以这里逐个攻击方式验证：
    //   只勾这一种时，当前面板就等于这一种自己的各段之和，不能混进别的攻击方式。
    assert.ok(w.modes.length >= 2, `巴什穆应有多个模式，实际 ${w.modes.length}`);
    const hasBeam = w.modes.some((m) => m.trigger === 'held');
    assert.ok(hasBeam, '巴什穆的次要射击（名为 Held）应是射线模式');

    for (const m of w.modes) {
      for (let vi = 0; vi < m.variants.length; vi++) {
        const v = m.variants[vi]!;
        // 只勾这一个攻击方式（传下标数组）
        const res = compute(w, m, [], {}, [vi]);
        const own: Record<string, number> = {};
        for (const seg of v.segments) {
          for (const [k, val] of Object.entries(seg.damage ?? {})) own[k] = (own[k] ?? 0) + (val ?? 0);
        }
        const cur = res.spreadByVariant[0]!;
        assert.equal(
          sumSpread(cur),
          sumSpread(own as never),
          `模式 ${m.id} / 攻击方式 ${v.id} 单选时应等于其各段之和`,
        );
        for (const k of Object.keys(cur) as (keyof typeof cur)[]) {
          if ((cur[k] ?? 0) > 0) {
            assert.ok(own[k] !== undefined, `${m.id}/${v.id} 混入了自身没有的伤害类型 ${String(k)}`);
          }
        }
      }
    }
  });

  it('巴兹火枪（Buzlok）没有爆炸变体（官方 explosiveAttack 40 已剔除，D-121）', async () => {
    const all = await loadAllWeapons();
    const w = all.find((x) => x.id === 'GrnGorgSniperRifle');
    assert.ok(w, '找不到巴兹火枪');
    const m = w.modes[0]!;
    // 需求方 2026-11-06：「巴兹火枪……没有爆炸也没有范围伤害……这个爆炸还是要删掉的」
    assert.equal(m.variants.findIndex((v) => v.id === 'blast'), -1, '巴兹火枪不该再有爆炸变体');
    for (const v of m.variants) {
      assert.equal(baseOf(v).blast, undefined, `变体 ${v.id} 不该含爆炸`);
    }
    const res = compute(w, { ...m, segments: m.variants[0]!.segments } as unknown as AttackMode, [], {});
    const cur = res.spreadByVariant[0]!;
    assert.equal(cur.blast, undefined, '当前面板不该出现爆炸');
    // D-148：换源到 WFCD 后各段数值变了（现在是 冲击 30 + 穿刺 24 + 切割 6，外加一段穿刺 3），
    //        合计不再写死，改为「按数据各段相加」对比，数据变了测试跟着变。
    const expected = m.variants[0]!.segments.reduce(
      (s, seg) => s + Object.values(seg.damage ?? {}).reduce((a: number, b) => a + (b ?? 0), 0),
      0,
    );
    assert.ok(
      Math.abs(sumSpread(cur) - expected) < 1e-6,
      `直接命中合计应等于各段之和 ${expected}，实际 ${sumSpread(cur)}`,
    );
  });

  it('全库扫描：所有多变体武器、所有变体都满足（无 Mod 时）', async () => {
    const all = await loadAllWeapons();
    const failures: string[] = [];
    for (const w of all) {
      for (const m of w.modes) {
        if (m.variants.length < 2) continue;
        const res = compute(w, { ...m, segments: m.variants[0]!.segments } as unknown as AttackMode, [], {});
        m.variants.forEach((v, i) => {
          const base = baseOf(v);
          const cur = res.spreadByVariant[i] ?? {};
          const same =
            Math.abs(sumSpread(base) - sumSpread(cur)) < 1e-6 &&
            JSON.stringify(Object.keys(base).sort()) === JSON.stringify(Object.keys(cur).sort());
          if (!same) failures.push(`${w.id} ${m.id}/${v.id}: 基础 ${sumSpread(base)} vs 当前 ${sumSpread(cur)}`);
        });
      }
    }
    assert.deepEqual(failures, [], `有 ${failures.length} 个组合不符`);
  });

  it('totalSpread 仍是所有变体之和（保留原语义）', async () => {
    const all = await loadAllWeapons();
    const w = all.find((x) => x.id === 'SentRifleNewWarGun');
    assert.ok(w);
    const m = w.modes[0]!;
    const res = compute(w, { ...m, segments: m.variants[0]!.segments } as unknown as AttackMode, [], {});
    const sumOfVariants = res.spreadByVariant.reduce((a, s) => a + sumSpread(s), 0);
    assert.ok(Math.abs(sumSpread(res.totalSpread) - sumOfVariants) < 1e-6);
  });
});
