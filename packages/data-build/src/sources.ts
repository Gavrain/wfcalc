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
