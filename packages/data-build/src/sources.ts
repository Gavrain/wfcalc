/**
 * 数据源常量。
 *
 * 注意：本机 PowerShell/curl 的 schannel 存在凭据异常，但 Node 原生 fetch 正常。
 * 因此所有抓取都必须走 Node fetch，不要调用 curl 或 Invoke-WebRequest。
 */
export const EXPORT_BASE = 'https://browse.wf/warframe-public-export-plus';

export const SOURCES = {
  weapons: `${EXPORT_BASE}/ExportWeapons.json`,
  upgrades: `${EXPORT_BASE}/ExportUpgrades.json`,
  recipes: `${EXPORT_BASE}/ExportRecipes.json`,
  /** 武器赋能：官方导出里**有**结构化逐级数值（与 Mod 不同），见 research/03 */
  arcanes: `${EXPORT_BASE}/ExportArcanes.json`,
  /** 套装加成（装 2 件及以上同系列模组生效） */
  modSets: `${EXPORT_BASE}/ExportModSet.json`,
  /** 语言包（本地化名称）：键为语言代码，如 zh / en / tc */
  langZh: `${EXPORT_BASE}/dict.zh.json`,
  langEn: `${EXPORT_BASE}/dict.en.json`,
} as const;

export type SourceName = keyof typeof SOURCES;

/**
 * 武器数据源（D-148：**全面转向 WFCD**）。
 *
 * 需求方 2026-11-11：官方导出的 `ExportWeapons.json` 错误太多，只当参考；
 * 武器面板以 WFCD/warframe-items 为准。换源理由：
 *   · 官方 `stateName` 只给到 `Loadout_TriggerContinous` 一层，混着射线本体、灵化射线、
 *     毒云、锯盘弹射、霰弹附带火焰，无法洗净；
 *   · 官方把幻离子记成"蓄力、病毒 5"，而 WFCD 记成"主模式射线（冲击 5 + 辐射 10）
 *     + 子母弹副模式"，与游戏一致；
 *   · WFCD 的扳机已归一为 Auto / Semi / Burst / Charge / Held / Active / Duplex，
 *     攻击按名字拆成 `Normal Attack` / `Incarnon Form` / `Radial Attack` …，
 *     且每条攻击带 `shot_type`（Hit-Scan / Projectile / AoE）——射线与范围伤害都靠它判。
 *
 * ⚠ WFCD 的 raw 路径要能连上 GitHub（本机 TLS 会被拦，需 `WFCD_INSECURE_TLS=1` 或走缓存）。
 */
export const WFCD_WEAPON_SOURCES = {
  primary: 'https://raw.githubusercontent.com/WFCD/warframe-items/master/data/json/Primary.json',
  secondary: 'https://raw.githubusercontent.com/WFCD/warframe-items/master/data/json/Secondary.json',
  melee: 'https://raw.githubusercontent.com/WFCD/warframe-items/master/data/json/Melee.json',
  archGun: 'https://raw.githubusercontent.com/WFCD/warframe-items/master/data/json/Arch-Gun.json',
  archMelee: 'https://raw.githubusercontent.com/WFCD/warframe-items/master/data/json/Arch-Melee.json',
  sentinelWeapons: 'https://raw.githubusercontent.com/WFCD/warframe-items/master/data/json/SentinelWeapons.json',
} as const;

export type WfcdWeaponSourceName = keyof typeof WFCD_WEAPON_SOURCES;

/** WFCD 许可（与 Mod 源相同） */
export const WFCD_LICENSE = 'MIT (WFCD/warframe-items)';

/**
 * Mod 数值的二级来源（官方导出里没有数值，见 research/03-Mod数据抓取.md）。
 *
 * Mod 的数值 / 等级上限 / 互斥 / 条件效果全部来自仓库内入库的
 * `packages/data/src/mods/**` 下的 JSON（见 `mods/baseline.ts`），**不读任何仓库外的文件**。
 * 早先有一个"读本地大 HTML 抠出数值"的入口，已删除：项目不能依赖一份不在版本管理里的外部文件，
 * 否则换设备、或者文件不在时，流水线就产不出正确数值。
 *
 *   wfcd    WFCD/warframe-items 的 Mods.json（MIT 许可），只用来交叉校验、
 *           补词缀套装/集团等元信息——它的数值是"每级的展示文本"，不是结构化数值。
 *
 * 注意 GitHub 的 TLS 证书在本机会被拦截（UNABLE_TO_VERIFY_LEAF_SIGNATURE），
 * 抓 WFCD 需要先设置 `WFCD_INSECURE_TLS=1` 让脚本跳过证书校验，或者直接用缓存。
 */
export const MOD_SOURCES = {
  wfcdMods: {
    kind: 'remote',
    url: 'https://raw.githubusercontent.com/WFCD/warframe-items/master/data/json/Mods.json',
    license: 'MIT (WFCD/warframe-items)',
  },
} as const;

/** Mod 人工基线目录（入库，是 Mod 数值的唯一来源） */
export const MOD_BASELINE_DIR = 'packages/data/src/mods';
/** 抓取产物目录：本地缓存，不进仓库 */
export const CACHE_DIR = '.cache/export';
