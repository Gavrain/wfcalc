/**
 * 名称本地化。
 *
 * 官方导出里的 `name` 只是语言包键（如 `/Lotus/Language/ClanTech/RocketLauncher`），
 * 本身不含显示名。显示名在语言包 `dict.<lang>.json` 里，键与控制台导出一致。
 *
 * 用法：把导出的语言键在中文包 / 英文包里查一次即可得到显示名。
 */

export type LanguageDict = Record<string, string>;

export interface LocalizedName {
  en: string;
  zh?: string;
}

/**
 * 从语言包解析名称。
 * @param languageKey 导出里的 name 字段（完整语言键路径）
 * @param zh 中文语言包
 * @param en 英文语言包（可选，缺失时回退到语言键的末段）
 */
export function resolveName(
  languageKey: string | undefined,
  zh: LanguageDict,
  en?: LanguageDict,
): LocalizedName {
  if (!languageKey) return { en: '(未知)' };

  const english = en?.[languageKey];
  const chinese = zh[languageKey];

  // 名称类的键通常以 Name 结尾；若直接键未命中，尝试去后缀的变体
  const fallback = languageKey.split('/').pop() ?? languageKey;

  return {
    en: english ?? fallback,
    ...(chinese ? { zh: chinese } : {}),
  };
}

/** 统计语言键命中率，用于报告 */
export function nameCoverage(
  keys: string[],
  dict: LanguageDict,
): { total: number; hit: number; ratio: number; missingSamples: string[] } {
  let hit = 0;
  const missing: string[] = [];
  for (const k of keys) {
    if (dict[k]) hit++;
    else if (missing.length < 20) missing.push(k);
  }
  return {
    total: keys.length,
    hit,
    ratio: keys.length > 0 ? hit / keys.length : 0,
    missingSamples: missing,
  };
}
