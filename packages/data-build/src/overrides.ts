/**
 * 应用人工覆盖层。
 *
 * 在 clean 之后、diff/emit 之前调用。
 * 每个覆盖都会记录到 applied 列表，便于报告里展示"哪些字段来自人工"。
 */
import type { Weapon } from '../../core/src/weapon.ts';

export interface OverrideSource {
  fireRate?: number;
  chargeTime?: number;
  critChance?: number;
  critMultiplier?: number;
  statusChance?: number;
  magazineSize?: number;
  reloadTime?: number;
  needsManualReview?: boolean;
  note?: string;
}

export interface AppliedOverride {
  weaponId: string;
  field: string;
  from: number | undefined;
  to: number;
  reason: string;
}

/**
 * 蓄力时间 → 射速。
 * 规则（需求方确认）：蓄力 0.5s 的射速为 2，即 射速 = 1 / 蓄力时间。
 */
export function chargeTimeToFireRate(chargeTime: number): number {
  if (!(chargeTime > 0)) return 0;
  return Math.round((1 / chargeTime) * 1e4) / 1e4;
}

/**
 * 把覆盖层应用到武器列表（原地修改并返回应用记录）。
 */
export function applyOverrides(
  weapons: Weapon[],
  overrides: Record<string, OverrideSource>,
): AppliedOverride[] {
  const applied: AppliedOverride[] = [];
  const byId = new Map(weapons.map((w) => [w.id, w]));

  for (const [weaponId, ov] of Object.entries(overrides)) {
    const w = byId.get(weaponId);
    if (!w) continue;

    // 蓄力时间优先于直接给射速，且只在导出射速缺失/为 0 时使用
    if (ov.chargeTime != null) {
      const derived = chargeTimeToFireRate(ov.chargeTime);
      if (w.fireRate === 0 || ov.fireRate != null) {
        applied.push({
          weaponId,
          field: 'fireRate',
          from: w.fireRate,
          to: derived,
          reason: ov.note ?? `按蓄力 ${ov.chargeTime}s 反推射速`,
        });
        w.fireRate = derived;
      }
    }

    if (ov.fireRate != null && ov.chargeTime == null) {
      applied.push({ weaponId, field: 'fireRate', from: w.fireRate, to: ov.fireRate, reason: ov.note ?? '人工指定' });
      w.fireRate = ov.fireRate;
    }

    for (const field of ['critChance', 'critMultiplier', 'statusChance', 'magazineSize', 'reloadTime'] as const) {
      const value = ov[field];
      if (value == null) continue;
      const from = w[field];
      applied.push({ weaponId, field, from, to: value, reason: ov.note ?? '人工指定' });
      if (field === 'magazineSize' || field === 'reloadTime') {
        w[field] = value;
      } else {
        w[field] = value;
      }
    }
  }

  return applied;
}
