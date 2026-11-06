/**
 * 武器数据的「已知问题」清单（人工层，D-101）。
 *
 * **用途**：需求方在武器切换下拉栏里能一眼看到哪些武器的数据不完整，
 * 选中后去「编辑面板」（开发者编辑模式）修正，避免拿着错数据算半天。
 *
 * **原则**：只登记**已确认有问题**的武器，宁可少登记也不要误标——
 * 误标会让用户以为没问题的武器也有问题。
 *
 * 生成方式：`node packages/data/manual/find-issues.mjs`（重新产出数据后可复核）。
 * 抓取/生成日期：2026-11-06。
 */
export type WeaponIssueCode =
  /** 灵化武器清单里有，但导出数据没有灵化 behaviour，灵化形态缺失 */
  | 'incarnonMissing'
  /** 灵化模式已生成，但面板数值是"复用基础面板"的占位值（D-110 / D-111） */
  | 'incarnonPanelReused'
  /** 枪械的射击模式 trigger 无法从 stateName 识别（多为射线/持续类） */
  | 'triggerUnknown';

export interface WeaponIssue {
  code: WeaponIssueCode;
  /** 给用户看的一行说明 */
  note: string;
  /** 判定依据的来源 */
  _source: string;
}

const INCARNON_MISSING: WeaponIssue = {
  code: 'incarnonMissing',
  note: '灵化形态缺失',
  _source: 'manual/incarnon.ts 清单内有此武器，但 ExportWeapons 只有 1 个 behaviour，灵化形态没有导出',
};

const INCARNON_PANEL_REUSED: WeaponIssue = {
  code: 'incarnonPanelReused',
  note: '灵化面板未收录（复用基础面板）',
  _source: 'manual/incarnon-stats.ts 里还没有这把武器的灵化数值，面板暂按基础面板占位',
};

const TRIGGER_UNKNOWN: WeaponIssue = {
  code: 'triggerUnknown',
  note: '射击模式未识别',
  _source: 'ExportWeapons 的 stateName 无法映射到 auto/semi/burst/charge/held（多为射线/持续类）',
};

/**
 * 武器 id（generated 里的 id）→ 问题列表。
 */
export const WEAPON_ISSUES: Readonly<Record<string, WeaponIssue[]>> = {
  // ── 灵化形态缺失（12 把，D-100 已知限制）──
  "CeramicDagger": [INCARNON_MISSING],
  "DestrezaPrime": [INCARNON_MISSING],
  "DexFuris": [INCARNON_MISSING],
  "FuraxWraith": [INCARNON_MISSING],
  "MK1Bo": [INCARNON_MISSING],
  "MK1Furax": [INCARNON_MISSING],
  "MK1Strun": [INCARNON_MISSING],
  "PrimeBoar": [INCARNON_MISSING],
  "PrimeOkina": [INCARNON_MISSING],
  "PrismaObex": [INCARNON_MISSING],
  "PrismaSkana": [INCARNON_MISSING],
  "SkanaPrime": [INCARNON_MISSING],

  // ── 灵化面板复用基础面板（22 把，D-111）──
  "AutoCrossBow": [INCARNON_PANEL_REUSED],
  "BratonPrime": [INCARNON_PANEL_REUSED],
  "BroncoPrime": [INCARNON_PANEL_REUSED],
  "DeraVandal": [INCARNON_PANEL_REUSED],
  "HuntingBow": [INCARNON_PANEL_REUSED],
  "Kunai": [INCARNON_PANEL_REUSED],
  "LatoPrime": [INCARNON_PANEL_REUSED],
  "LatoVandal": [INCARNON_PANEL_REUSED],
  "LatronPrime": [INCARNON_PANEL_REUSED],
  "MK1Furis": [INCARNON_PANEL_REUSED],
  "MK1Kunai": [INCARNON_PANEL_REUSED],
  "MK1Paris": [INCARNON_PANEL_REUSED],
  "PrimeBallistica": [INCARNON_PANEL_REUSED],
  "PrimeBoltor": [INCARNON_PANEL_REUSED],
  "PrimeBurston": [INCARNON_PANEL_REUSED],
  "PrimeHuntingBow": [INCARNON_PANEL_REUSED],
  "PrimeLex": [INCARNON_PANEL_REUSED],
  "PrismaAngstrum": [INCARNON_PANEL_REUSED],
  "RVBallistica": [INCARNON_PANEL_REUSED],
  "StalkerBow": [INCARNON_PANEL_REUSED],
  "WraithGorgon": [INCARNON_PANEL_REUSED],
  "WraithLatron": [INCARNON_PANEL_REUSED],

  // ── 射击模式未识别（30 把枪械，多为射线/持续类）──
  "AutoPistol": [TRIGGER_UNKNOWN],
  "CSDroidArray": [TRIGGER_UNKNOWN],
  "CSSynoidGammacor": [TRIGGER_UNKNOWN],
  "ChainLightningRifle": [TRIGGER_UNKNOWN],
  "CodaCatabolyst": [TRIGGER_UNKNOWN],
  "CodaSynapse": [TRIGGER_UNKNOWN],
  "CrpBECycron": [TRIGGER_UNKNOWN],
  "CrpBEGlaxion": [TRIGGER_UNKNOWN],
  "CrpChargeGun": [TRIGGER_UNKNOWN],
  "CrpFreezeRayRifle": [TRIGGER_UNKNOWN],
  "CrpFreezeRayVandalRifle": [TRIGGER_UNKNOWN],
  "CrpLaserPistol": [TRIGGER_UNKNOWN],
  "CrpLaserPistolVandal": [TRIGGER_UNKNOWN],
  "CrpLaserRifle": [TRIGGER_UNKNOWN],
  "CrpSentExperimentPistol": [TRIGGER_UNKNOWN],
  "CrpSentExperimentRifle": [TRIGGER_UNKNOWN],
  "CrpSplitLaser": [TRIGGER_UNKNOWN],
  "EntratiWristGunWeapon": [TRIGGER_UNKNOWN],
  "FlameThrower": [TRIGGER_UNKNOWN],
  "FlameThrowerWraith": [TRIGGER_UNKNOWN],
  "GrnMicrowavePistol": [TRIGGER_UNKNOWN],
  "InfBeamPistol": [TRIGGER_UNKNOWN],
  "InfestedRifle": [TRIGGER_UNKNOWN],
  "InfestedShotgun": [TRIGGER_UNKNOWN],
  "KuvaNukor": [TRIGGER_UNKNOWN],
  "MK1Furis": [TRIGGER_UNKNOWN],
  "PrimeAthodaiPistolWeapon": [TRIGGER_UNKNOWN],
  "ThanoTechGrenadeLauncher": [TRIGGER_UNKNOWN],
  "ThanotechPistol": [TRIGGER_UNKNOWN],
  "TnJetTurbinePistolWeapon": [TRIGGER_UNKNOWN],

};

/** 查某把武器的问题列表（空数组表示没问题） */
export function issuesOf(weaponId: string | undefined): WeaponIssue[] {
  if (!weaponId) return [];
  return WEAPON_ISSUES[weaponId] ?? [];
}

/** 是否有任何已知问题 */
export function hasIssues(weaponId: string | undefined): boolean {
  return issuesOf(weaponId).length > 0;
}
