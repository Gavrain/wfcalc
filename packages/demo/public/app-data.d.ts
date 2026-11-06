/**
 * `app-data.js` 的类型声明（只为测试与类型检查服务；运行时代码是纯 JS）。
 *
 * `groupWeapons` 这类函数在 `weapon-picker.d.ts` 里声明，这里只补赋能范围相关的纯函数。
 */

export interface SlotFileEntry {
  slots?: { broad?: string; specific?: string[]; basis?: unknown };
  trueBow?: boolean;
  subclass?: string | null;
  isDualPistols?: boolean;
  modKinds?: string[];
}

export interface WeaponLike {
  category?: string;
  [k: string]: unknown;
}

export interface ArcaneLike {
  name?: { zh?: string };
  category?: string;
  key?: string;
}

/** 武器**可装**的赋能大类 id 数组（`dual` 为虚拟大类） */
export declare function arcaneCategoriesFor(weapon: WeaponLike | undefined, slotEntry: SlotFileEntry | undefined): string[];

/** 一条赋能能否装在该武器上 */
export declare function isArcaneUsableOn(
  arcane: ArcaneLike,
  weapon: WeaponLike | undefined,
  slotEntry: SlotFileEntry | undefined,
): boolean;
