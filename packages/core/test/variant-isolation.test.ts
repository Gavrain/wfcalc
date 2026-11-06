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
  it('巴什穆（Basmu）爆炸变体不被命中段污染', async () => {
    const all = await loadAllWeapons();
    const w = all.find((x) => x.id === 'SentRifleNewWarGun');
    assert.ok(w, '找不到巴什穆');
    const m = w.modes[0]!;
    assert.equal(m.variants.length, 2, '巴什穆应有 直接命中 / 爆炸 两个变体');
    const res = compute(w, { ...m, segments: m.variants[0]!.segments } as unknown as AttackMode, [], {}, false);
    const blastIdx = m.variants.findIndex((v) => v.id === 'blast');
    assert.ok(blastIdx >= 0);
    const base = baseOf(m.variants[blastIdx]!);
    const cur = res.spreadByVariant[blastIdx]!;
    assert.equal(sumSpread(cur), sumSpread(base), '爆炸变体当前值应等于其基础值');
    // 爆炸变体里不该出现命中段的物理伤害
    assert.equal(cur.impact, undefined, '爆炸变体不该混入冲击');
    assert.equal(cur.puncture, undefined, '爆炸变体不该混入穿刺');
    assert.equal(cur.slash, undefined, '爆炸变体不该混入切割');
  });

  it('巴兹火枪（Buzlok）爆炸变体不含命中段', async () => {
    const all = await loadAllWeapons();
    const w = all.find((x) => x.id === 'GrnGorgSniperRifle');
    assert.ok(w, '找不到巴兹火枪');
    const m = w.modes[0]!;
    const res = compute(w, { ...m, segments: m.variants[0]!.segments } as unknown as AttackMode, [], {}, false);
    const blastIdx = m.variants.findIndex((v) => v.id === 'blast');
    assert.ok(blastIdx >= 0);
    assert.equal(sumSpread(res.spreadByVariant[blastIdx]!), sumSpread(baseOf(m.variants[blastIdx]!)));
  });

  it('全库扫描：所有多变体武器、所有变体都满足（无 Mod 时）', async () => {
    const all = await loadAllWeapons();
    const failures: string[] = [];
    for (const w of all) {
      for (const m of w.modes) {
        if (m.variants.length < 2) continue;
        const res = compute(w, { ...m, segments: m.variants[0]!.segments } as unknown as AttackMode, [], {}, false);
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
    const res = compute(w, { ...m, segments: m.variants[0]!.segments } as unknown as AttackMode, [], {}, false);
    const sumOfVariants = res.spreadByVariant.reduce((a, s) => a + sumSpread(s), 0);
    assert.ok(Math.abs(sumSpread(res.totalSpread) - sumOfVariants) < 1e-6);
  });
});
