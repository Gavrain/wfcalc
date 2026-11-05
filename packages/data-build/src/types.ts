/**
 * 官方导出结构的最小类型定义。
 * 只声明我们用到的字段——上游多出来的字段一律忽略，不会导致失败。
 */

export interface ExportAttack {
  procChance?: number;
  [dtKey: string]: number | undefined;
}

export interface ExportProjectile {
  attack?: ExportAttack;
  explosiveAttack?: ExportAttack;
  embedDeathAttack?: ExportAttack;
}

export interface ExportBehaviour {
  stateName?: string;
  fireIterations?: number;
  burst?: { count: number; delay: number };
  impact?: ExportAttack;
  projectile?: ExportProjectile;
  /** 蓄力发射的投射数据；与 projectile 相同表示"只能蓄满发射" */
  chargedProjectile?: ExportProjectile;
}

export interface ExportWeapon {
  name?: string;
  parentName?: string;
  productCategory?: string;
  holsterCategory?: string;
  compatibilityTags?: string[];
  damagePerShot?: number[];
  totalDamage?: number;
  criticalChance?: number;
  criticalMultiplier?: number;
  procChance?: number;
  fireRate?: number;
  multishot?: number;
  trigger?: string;
  magazineSize?: number;
  reloadTime?: number;
  behaviours?: ExportBehaviour[];
  // 近战
  range?: number;
  followThrough?: number;
  comboDuration?: number;
  slamAttack?: number;
  slamRadialDamage?: number;
  slamRadius?: number;
  slideAttack?: number;
  heavyAttackDamage?: number;
  heavySlamAttack?: number;
  heavySlamRadialDamage?: number;
  heavySlamRadius?: number;
}

export type ExportWeapons = Record<string, ExportWeapon>;
