/**
 * 变更对比。
 *
 * 需求方说明：常态是"版本新增武器"或"热修改少量武器"，所以报告按三类分别列出，
 * 并突出显示"数值变动"——这是最需要人看一眼再确认的部分。
 */
import type { Weapon } from '../../core/src/weapon.ts';

export interface FieldChange {
  weaponId: string;
  field: string;
  from: number | string;
  to: number | string;
}

export interface DiffReport {
  added: string[];
  removed: string[];
  changed: FieldChange[];
  unchanged: number;
  /** 结论：是否需要人工重点确认 */
  needsAttention: boolean;
}

function flattenWeapon(w: Weapon): Record<string, number | string> {
  const flat: Record<string, number | string> = {
    category: w.category,
    critChance: w.critChance,
    critMultiplier: w.critMultiplier,
    statusChance: w.statusChance,
    fireRate: w.fireRate,
    magazineSize: w.magazineSize ?? 0,
    reloadTime: w.reloadTime ?? 0,
    modeCount: w.modes.length,
  };

  w.modes.forEach((m, i) => {
    flat[`mode[${i}].trigger`] = m.trigger;
    flat[`mode[${i}].bullets`] = m.bullets;
    flat[`mode[${i}].multishot`] = m.multishot;
    if (m.burst) flat[`mode[${i}].burstCount`] = m.burst.count;
    // D-080：段只属于变体，路径带上变体 id，能直接看出是「直接命中」还是「爆炸」变了
    m.variants.forEach((v, vi) => {
      if (v.override) {
        for (const [k, val] of Object.entries(v.override)) {
          if (typeof val === 'number') flat[`mode[${i}].variant[${vi}].${v.id}.override.${k}`] = val;
        }
      }
      v.segments.forEach((s, j) => {
        const p = `mode[${i}].variant[${vi}].${v.id}.seg[${j}]`;
        flat[`${p}.kind`] = s.kind;
        flat[`${p}.procChance`] = s.procChance;
        for (const [type, value] of Object.entries(s.damage)) {
          if (typeof value !== 'number') continue;
          flat[`${p}.${type}`] = value;
        }
      });
    });
  });

  return flat;
}

/** 数值比较的容差，避免浮点噪声造成假变更 */
const EPS = 1e-4;

function differs(a: number | string | undefined, b: number | string | undefined): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) > EPS;
  return a !== b;
}

export function diffWeapons(previous: Weapon[], next: Weapon[]): DiffReport {
  const prevById = new Map(previous.map((w) => [w.id, w]));
  const nextById = new Map(next.map((w) => [w.id, w]));

  const added: string[] = [];
  const removed: string[] = [];
  const changed: FieldChange[] = [];
  let unchanged = 0;

  for (const [id, w] of nextById) {
    const before = prevById.get(id);
    if (!before) {
      added.push(id);
      continue;
    }

    const a = flattenWeapon(before);
    const b = flattenWeapon(w);
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    const weaponChanges: FieldChange[] = [];
    for (const field of keys) {
      if (differs(a[field], b[field])) {
        weaponChanges.push({
          weaponId: id,
          field,
          from: a[field] ?? '(无)',
          to: b[field] ?? '(无)',
        });
      }
    }
    if (weaponChanges.length === 0) unchanged++;
    else changed.push(...weaponChanges);
  }

  for (const id of prevById.keys()) {
    if (!nextById.has(id)) removed.push(id);
  }

  added.sort();
  removed.sort();
  changed.sort((x, y) => (x.weaponId < y.weaponId ? -1 : x.weaponId > y.weaponId ? 1 : x.field < y.field ? -1 : 1));

  return {
    added,
    removed,
    changed,
    unchanged,
    needsAttention: added.length > 0 || removed.length > 0 || changed.length > 0,
  };
}

/** 生成给人看的报告 */
export function formatDiffReport(report: DiffReport, opts: { maxChangedWeapons?: number } = {}): string {
  const lines: string[] = [];
  lines.push('变更报告');
  lines.push('='.repeat(60));

  if (!report.needsAttention) {
    lines.push('与上一版完全一致，无需确认。');
    return lines.join('\n');
  }

  lines.push(`新增武器：${report.added.length} 把`);
  for (const id of report.added) lines.push(`  + ${id}`);

  lines.push(`移除武器：${report.removed.length} 把`);
  for (const id of report.removed) lines.push(`  - ${id}`);

  const byWeapon = new Map<string, FieldChange[]>();
  for (const c of report.changed) {
    const list = byWeapon.get(c.weaponId) ?? [];
    list.push(c);
    byWeapon.set(c.weaponId, list);
  }

  const max = opts.maxChangedWeapons ?? 50;
  lines.push(`数值变动：${byWeapon.size} 把武器，共 ${report.changed.length} 处`);
  let shown = 0;
  for (const [id, changes] of byWeapon) {
    if (shown >= max) {
      lines.push(`  ... 还有 ${byWeapon.size - shown} 把未显示`);
      break;
    }
    lines.push(`  ~ ${id}`);
    for (const c of changes) lines.push(`      ${c.field}: ${c.from} → ${c.to}`);
    shown++;
  }

  lines.push(`未变动：${report.unchanged} 把`);
  return lines.join('\n');
}
