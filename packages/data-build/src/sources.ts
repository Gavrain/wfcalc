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
} as const;

export type SourceName = keyof typeof SOURCES;

/** 抓取产物目录：本地缓存，不进仓库 */
export const CACHE_DIR = '.cache/export';
