/**
 * `app-store.js` 配卡存档部分的类型声明（只为测试与类型检查服务；运行时代码是纯 JS）。
 *
 * 只声明 D-157 新增的读写函数；`store` / `fmt` 等其他导出保持隐式类型（页面侧 `app.js`
 * 本来就不做类型检查，这里不重复声明它们）。
 */

/** 一套配卡：8 个槽 + 劣化槽 + 赋能槽，外加这把武器自己的界面状态 */
export interface SavedLoadout {
  slots: (string | null)[];
  exilus: string | null;
  arcane: string | null;
  /** 模式索引 / 攻击方式勾选 / 配置区；没有存过就是 null */
  ui: Record<string, unknown> | null;
}

export declare const LOADOUT_STORE_KEY: string;
export declare const LOADOUT_MAX_WEAPONS: number;

/** 把槽位数组整理成存档形状 */
export declare function makeLoadoutEntry(
  slots: readonly (string | null)[] | undefined,
  exilusId: string | null | undefined,
  arcaneKey: string | null | undefined,
): SavedLoadout;

/** 读某把武器的配卡；`null` = 从没存过（调用方应清空） */
export declare function getSavedLoadout(weaponId: string): SavedLoadout | null;

/** 保存某把武器的配卡；返回是否真的写进了存储 */
export declare function saveLoadout(
  weaponId: string,
  entry?: SavedLoadout | null,
  current?: Record<string, unknown> | null,
): boolean;

/** 上次退出时用的是哪把武器 */
export declare function lastWeaponId(): string | null;

/** 上次保存的界面状态 */
export declare function lastUiState(): Record<string, unknown> | null;

/** 清空整份存档 */
export declare function clearLoadoutStore(): void;
