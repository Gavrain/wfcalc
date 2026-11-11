/**
 * WFCD 缺失武器的兜底（D-148 补充）。
 *
 * 需求方 2026-11-11：「全面切换到 WFCD，官方数据错的太多，只当参考」。
 * 但 WFCD 不收录**显赫武器**（战甲技能武器，如圣剑刀 / 女武神爪 / 铁棒）与哈尔武，
 * 直接换源会让 36 把有真实面板的武器凭空消失。
 *
 * 处理：以 WFCD 为主，**只在 WFCD 没有这把武器时**，用官方导出的清洗结果补上，
 * 并在模式上打 `_manual: 'export-missing'` 标记 + `_note` 说明来源，
 * 界面据此提示"该武器 WFCD 未收录，数值来自官方导出，可能有误"。
 * 数据能追溯（CLAUDE.md 规则 3）。
 */
import type { Weapon } from '../../core/src/weapon.ts';
import type { CleanedWeapon } from './clean.ts';

export interface FilledWeapon extends Weapon {
  /** 该武器不在 WFCD 里，数值来自官方导出 */
  _fromOfficialExport?: true;
}

/** 标记兜底武器：模式上加来源说明 */
function markFallback(w: CleanedWeapon): FilledWeapon {
  const note = 'WFCD 未收录该武器（多为显赫武器），面板来自官方导出，可能有误';
  return {
    ...w,
    _fromOfficialExport: true,
    modes: w.modes.map((m) => ({
      ...m,
      _manual: 'export-missing' as const,
      _note: m._note ? `${m._note}；${note}` : note,
    })),
  };
}

/**
 * 把 WFCD 缺的武器用官方导出补回来。
 *
 * @param wfcd      WFCD 清洗结果（主数据源）
 * @param official  官方导出清洗结果（只用于补齐，不覆盖已有的）
 * @returns 合并后的武器列表 + 统计
 */
export function fillFromOfficialExport(
  wfcd: readonly Weapon[],
  official: readonly CleanedWeapon[],
): { weapons: FilledWeapon[]; filled: string[] } {
  const have = new Set(wfcd.map((w) => w.id));
  const filled: string[] = [];
  const extra: FilledWeapon[] = [];

  for (const w of official) {
    if (have.has(w.id)) continue;
    filled.push(w.id);
    extra.push(markFallback(w));
  }

  const merged: FilledWeapon[] = [...wfcd, ...extra];
  merged.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { weapons: merged, filled };
}
