/**
 * 人工覆盖层。
 *
 * 目的：官方导出拿不到、或导出值错误的字段，由人工在此修正。
 * 每次 `--emit` 时自动应用，覆盖值优先级高于导出值。
 *
 * 设计原则：
 *   - 一个武器一条，字段与 WeaponPanel 同名，所见即所得
 *   - 只写需要改的部分，其它字段继续用导出值
 *   - 修改后跑 `--emit` 即可生效，diff 报告会列出变化
 */

export interface WeaponOverride {
  /**
   * 人工修正后的射速（发/秒）。
   * 用途：导出里 fireRate 为 0 的蓄力武器（如兰卡），用蓄力时间反推：
   *       蓄力 0.5s → 射速 2
   */
  fireRate?: number;
  /** 人工修正后的蓄力时间（秒），与 fireRate 二选一即可 */
  chargeTime?: number;
  critChance?: number;
  critMultiplier?: number;
  statusChance?: number;
  magazineSize?: number;
  reloadTime?: number;
  /** 标记该武器数据不全需人工处理，UI 会显示提示 */
  needsManualReview?: boolean;
  /** 人工备注，说明为什么改 */
  note?: string;
}

/** 全部人工覆盖，key 为武器内部 id */
export const WEAPON_OVERRIDES: Record<string, WeaponOverride> = {
  // 兰卡：蓄力狙击枪，导出射速为 0，需用蓄力时间反推
  Railgun: {
    chargeTime: 0.5,
    note: '导出射速为 0，按蓄力 0.5s 反推为 2 发/秒（待人工核实实际蓄力时间）',
  },
};
