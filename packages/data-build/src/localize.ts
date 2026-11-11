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

/**
 * 按**英文显示名**反查中文名（D-148：WFCD 数据源的路径）。
 *
 * WFCD 直接给英文显示名（`name` = `Phantasma`），不像官方导出那样给语言键，
 * 所以拿不到 `languageKey`。这里建一张「英文名 → 中文名」的反查表：
 * 遍历英文包，把每个键的英文值对应到中文包里同一个键的值。
 *
 * @returns 英文名 → 中文名；同一个英文名有多个中文时保留第一个
 */
export function buildZhByEnglishName(en: LanguageDict, zh: LanguageDict): Map<string, string> {
  const m = new Map<string, string>();
  for (const [key, english] of Object.entries(en)) {
    if (!english) continue;
    const chinese = zh[key];
    if (!chinese) continue;
    if (!m.has(english)) m.set(english, chinese);
  }
  return m;
}

/** 用英文显示名查中文名；查不到返回 undefined（界面回退到英文名） */
export function resolveZhByName(zhByEn: Map<string, string>, englishName: string | undefined): string | undefined {
  if (!englishName) return undefined;
  return zhByEn.get(englishName);
}

/**
 * 清掉语言包里的分类前缀（D-148）。
 *
 * 空战近战的中文名在语言包里带 `<ARCHWING>` 前缀（如 `<ARCHWING> 驯象钩刃`），
 * 那是官方给同部件分类打的标记，不是名字的一部分，界面不该显示。
 */
export function stripNamePrefix(zh: string): string {
  return zh.replace(/^\s*<[^>]{1,24}>\s*/u, '').trim();
}

/**
 * 构建「WFCD uniqueName 末段 → 官方语言键」的映射（D-148 换源后的中文名兜底）。
 *
 * WFCD 的 `name` 是英文显示名，多数能从语言包反查表直接命中；
 * 但空战近战等少数武器在语言包里搜索式反查不到（英文包里没有那条名字），
 * 这时用 `uniqueName` 末段去官方导出里找回语言键，再查中文包。
 *
 * @param officialWeapons 官方导出 `ExportWeapons.json`（只用来查语言键）
 */
export function buildLangKeyByWeaponId(
  officialWeapons: Record<string, { name?: string }>,
): Map<string, string> {
  const m = new Map<string, string>();
  for (const [uniqueName, w] of Object.entries(officialWeapons)) {
    if (!w?.name) continue;
    const id = uniqueName.split('/').pop();
    if (!id) continue;
    if (!m.has(id)) m.set(id, w.name);
  }
  return m;
}

/**
 * 解析 WFCD 武器的中文名（D-148）。
 *
 * 顺序：
 *   1. 语言包「英文名 → 中文名」反查表（覆盖绝大多数）；
 *   2. 反查不到时，用 `uniqueName` 末段查官方导出的语言键，再查中文包
 *      （救回空战近战等 28 把）；
 *   3. 都没有则返回 undefined，界面显示英文名。
 *
 * @param zh             中文语言包
 * @param zhByEn         英文名 → 中文名 反查表
 * @param langKeyById    uniqueName 末段 → 官方语言键
 */
export function resolveZhForWfcdWeapon(
  zh: LanguageDict,
  zhByEn: Map<string, string>,
  langKeyById: Map<string, string>,
  w: { name?: string; uniqueName?: string },
): string | undefined {
  const direct = resolveZhByName(zhByEn, w.name);
  if (direct) return stripNamePrefix(direct);

  const id = w.uniqueName?.split('/').pop();
  if (!id) return undefined;
  const key = langKeyById.get(id);
  if (!key) return undefined;
  const fromKey = zh[key];
  return fromKey ? stripNamePrefix(fromKey) : undefined;
}
