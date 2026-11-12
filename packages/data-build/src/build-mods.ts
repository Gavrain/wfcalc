/**
 * Mod 数据抓取与清洗流程。
 *
 * 用法：
 *   node --experimental-strip-types packages/data-build/src/build-mods.ts           # dry-run，只统计与报错
 *   ... --emit                                                                      # 写入产出
 *   ... --force                                                                     # 忽略缓存重新下载 WFCD
 *
 * 与武器流程一致的约定（需求方指定）：
 *   - 抓取失败立即停止并报告，不自动重试。
 *   - dry-run 默认不写任何产出，先把统计与异常项给人看。
 *   - 只有显式 --emit 才写入 packages/data/src/generated/。
 *
 * 与武器流程的差异：Mod 的**数值**不在官方导出里，来自入库的 `packages/data/src/mods/baseline.json`；
 * 官方 ExportUpgrades 与 WFCD 只用于**交叉校验**（耗点/稀有度/极性/中文名）。
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fetchSource } from './fetch.ts';
import { CACHE_DIR, MOD_SOURCES } from './sources.ts';
import { MOD_VALUE_OVERRIDES } from './mods/stat-map.ts';
import { baselinePath, loadModBaseline } from './mods/mod-record.ts';
import { cleanMod, isWeaponMod, isStanceMod, type CleanMod } from './mods/clean-mods.ts';
import { cleanArcane, type CleanArcane } from './mods/clean-arcanes.ts';
import { cleanModSets, type CleanModSet } from './mods/clean-modsets.ts';
import { lookupStat, registeredKeys } from './mods/stat-map.ts';
import {
  normalizeKey,
  exportSubclass,
  isTrueBow,
  isDualPistolByWfcd,
  resolveFromExport,
  resolveFromWfcd,
  slotsFromStanceTags,
  compatibleModKinds,
  type SlotResolution,
} from './mods/weapon-slots.ts';
import { fetchAllWfcdWeapons } from './wfcd-fetch.ts';
import { exclusionReason } from './wfcd-clean.ts';
import type { ExportWeapons } from './types.ts';
import type { LanguageDict } from './localize.ts';
import { lookupExaltedSlots } from '../../data/src/manual/exalted-slots.ts';
import { MANUAL_VARIANTS, MANUAL_WEAPON_ZH } from '../../data/src/manual/weapon-patches.ts';

const repoRoot = resolve(import.meta.dirname, '../../..');
const GENERATED_DIR = join(repoRoot, 'packages/data/src/generated');
const MODS_DIR = join(GENERATED_DIR, 'mods');
const REPORT_DIR = join(GENERATED_DIR, 'reports');

/**
 * 需求方 2026-11-06 指定的剔除清单（基线 id → 理由）。
 *   · aerial_ace：**战甲 Mod**（"空中制霸"，效果是击杀后刷新二段跳），不是武器 Mod，
 *     在基线里被标成 `t:"rifle"` 混进来了。
 *
 * 数值订正（不是剔除）见 `MOD_VALUE_OVERRIDES`。
 */
export const EXCLUDED_MODS: Readonly<Record<string, string>> = {
  aerial_ace: '战甲 Mod（击杀刷新二段跳），不是武器 Mod；基线误标为 rifle',
};


interface Args {
  emit: boolean;
  force: boolean;
}

function parseArgs(argv: string[]): Args {
  return { emit: argv.includes('--emit'), force: argv.includes('--force') };
}

/** 官方 ExportUpgrades 条目（只取用到的字段） */
interface OfficialUpgrade {
  uniqueName: string;
  name: string;
  rarity: string;
  baseDrain: number;
  fusionLimit: number;
  type: string;
  compatName?: string;
  description?: string;
}

interface OfficialUpgrades {
  [key: string]: {
    name?: string;
    rarity?: string;
    baseDrain?: number;
    fusionLimit?: number;
    type?: string;
    compatName?: string;
    description?: string;
  };
}

/** 官方赋能条目（只声明用到的字段） */
interface ArcaneRaw {
  name?: string;
  rarity?: string;
  levelStats?: unknown[];
}

/** 官方套装条目 */
interface ModSetRaw {
  description?: string;
  numUpgradesInSet?: number;
  levelStats?: unknown[];
}

/**
 * 武器槽位判定：**WFCD 为主，官方导出兜底**（D-152，需求方 2026-11-13：
 * 「全改成 WFCD 为主，除非有他确认不了的」）。
 *
 * | 顺序 | 数据源 | 判什么 |
 * |---|---|---|
 * | 1 | WFCD `type` + 所在文件 + `productCategory` | 宽类（步枪 / 弓 / 霰弹 / 狙击 / 手枪 / 近战 / 空战） |
 * | 2 | 官方导出 `compatibilityTags` 的架势标签 | 近战**细分**（巨镰 / 剑 / 锤…）——WFCD 没有这个字段 |
 * | 3 | 官方导出 `resolveFromExport` | ① 都判不出来时兜底（显赫武器、哈尔武等）；② 借它的架势标签补近战细分 |
 * | 4 | `manual/exalted-slots.ts` | 显赫武器的人工表 |
 */

/** WFCD 武器索引：id → 原始条目（判定槽位用 `type` / `productCategory` / 文件） */
interface WfcdWeaponIndexEntry {
  type?: string | undefined;
  productCategory?: string | undefined;
  /** 来自哪个 WFCD 文件（`Primary` / `Melee` …） */
  file?: string | undefined;
  /** WFCD 的英文显示名（补录新武器时当 name 用） */
  name?: string | undefined;
  /**
   * D-152：WFCD 自己的收录边界判为「不收」（天工刀身 / PvP 变体 / 指挥官武器 / 滑板 / 重复条目）。
   * 由 `wfcd-clean.ts` 的 `exclusionReason()` 判定——**同一份规则**，这里不另写一套。
   */
  excluded?: string | undefined;
}

/**
 * 抓 WFCD 武器并按 id 建索引（D-152：槽位判定改成 WFCD 为主后，这里必须有 WFCD 数据）。
 *
 * 与武器面板流程共用同一个抓取器与同一套缓存（`.cache/export/wfcd-*.json`）。
 * 抓不到时**不中断**：退化为全部走官方导出兜底，并在统计里说明（可追溯）。
 */
async function loadWfcdWeaponIndex(force: boolean): Promise<{ index: Map<string, WfcdWeaponIndexEntry>; nameById: Map<string, { name: string }>; note: string }> {
  const index = new Map<string, WfcdWeaponIndexEntry>();
  const nameById = new Map<string, { name: string }>();
  try {
    const list = await fetchAllWfcdWeapons({
      force,
      insecureTls: process.env.WFCD_INSECURE_TLS === '1',
    });
    for (const w of list) {
      const id = String(w.uniqueName ?? '').split('/').pop() ?? '';
      if (!id) continue;
      // 复用武器流程的收录边界：天工刀身 / 守护武器 / 滑板 / PvP / 重复条目都在这里判出来
      const excluded = exclusionReason(w) ?? undefined;
      index.set(id, {
        ...(w.type !== undefined ? { type: w.type } : {}),
        ...(w.productCategory !== undefined ? { productCategory: w.productCategory } : {}),
        ...(w.__source !== undefined ? { file: w.__source } : {}),
        ...(w.name !== undefined ? { name: w.name } : {}),
        ...(excluded !== undefined ? { excluded } : {}),
      });
      if (w.name !== undefined) nameById.set(id, { name: w.name });
    }
    return { index, nameById, note: `WFCD 武器 ${index.size} 条` };
  } catch (err) {
    const msg = (err as Error).message;
    return { index, nameById, note: `⚠️ WFCD 武器抓取失败，槽位判定全部退回官方导出：${msg}` };
  }
}

/** 从官方导出判定里取出**近战细分**（WFCD 没有这个字段，需求方：用官方架势兜底） */
function meleeSpecificOf(fromExport: SlotResolution): SlotResolution['specific'] {
  if (fromExport.broad !== 'melee') return [];
  return fromExport.specific;
}

/**
 * D-152：**WFCD 完全没收**的条目按 id 特征排除（需求方 2026-11-13：「全都清掉」）。
 *
 * WFCD 的 `exclusionReason()` 能覆盖它收录过的条目；滑板、部分天工造武部件、抗原/突变原
 * 只在官方导出里出现（WFCD 实测 0 条），只能按 id 命名认出来。
 *
 * | 特征 | 是什么 | 依据 |
 * |---|---|---|
 * | `Hoverboard` | K 式悬浮板部件（双桅 / 双子库娃…） | 滑板，不是武器 |
 * | `Antigen` / `Mutagen` | 感染体抗原 / 突变原 | 生物样本，不是武器 |
 * | `Tip` / `Handle` / `Balance` 等天工造武部件 id | 刀身 / 握柄 / 环 | 组装件，不是武器 |
 */
const WFCD_ABSENT_EXCLUSION = /Hoverboard|Antigen|Mutagen|^(Tip|Handle|Balance|InfestedTip|InfestedHandle|PvPVariantTip)\d/i;

/** 读取并缓存 WFCD Mods.json（可选，用于交叉校验） */
async function loadWfcd(force: boolean): Promise<{ mods: unknown[] | null; note: string }> {
  const cacheFile = join(repoRoot, CACHE_DIR, 'wfcd-mods.json');
  try {
    if (!force && existsSync(cacheFile)) {
      return { mods: JSON.parse(readFileSync(cacheFile, 'utf8')) as unknown[], note: '读缓存' };
    }
    const res = await fetch(MOD_SOURCES.wfcdMods.url);
    if (!res.ok) return { mods: null, note: `HTTP ${res.status}` };
    const text = await res.text();
    mkdirSync(join(repoRoot, CACHE_DIR), { recursive: true });
    writeFileSync(cacheFile, text);
    return { mods: JSON.parse(text) as unknown[], note: '已下载' };
  } catch (err) {
    const cause = (err as { cause?: { code?: string } }).cause;
    return { mods: null, note: `${(err as Error).message}${cause?.code ? ` (${cause.code})` : ''}` };
  }
}

/** 把中文名按英文名对齐到官方语言包（用于补基线缺中文的模组） */
function buildZhLookup(zh: LanguageDict, en: LanguageDict): Map<string, string> {
  // 英文显示名 → 中文显示名
  const map = new Map<string, string>();
  for (const [key, zhName] of Object.entries(zh)) {
    const enName = en[key];
    if (enName) map.set(normalizeKey(enName), zhName);
  }
  return map;
}

interface StatKeyUsage {
  key: string;
  count: number;
  mods: string[];
}

function formatStats(o: {
  total: number;
  weaponMods: number;
  arcanes: number;
  stances: number;
  withStats: number;
  unknownKeys: StatKeyUsage[];
  officialMatched: number;
  officialMissing: string[];
  zhMissing: string[];
  unresolvedWeapons: string[];
  wfcdNote: string;
  wfcdCrossChecked: number;
  wfcdMismatch: string[];
  rankFixes: number;
  weaponArcanes: number;
  arcaneSkipped: number;
  modSets: number;
  damageSets: number;
}): string {
  const pct = (a: number, b: number) => (b > 0 ? `${((a / b) * 100).toFixed(1)}%` : '-');
  const lines = [
    'Mod 抓取统计',
    '='.repeat(60),
    `基线条目：${o.total}`,
    `  武器 Mod：${o.weaponMods}（其中带属性数值 ${o.withStats}）`,
    `  武器赋能：${o.weaponArcanes}（剔除不影响武器伤害 ${o.arcaneSkipped}）`,
    `  套装：${o.modSets}（影响伤害的 ${o.damageSets}）`,
    `  基线里的赋能（未采用，官方数据更全）：${o.arcanes}`,
    `  架势：${o.stances}（不建模，仅识别）`,
    `属性键已登记：${registeredKeys().length} 个；未登记用到 ${o.unknownKeys.length} 个`,
    `官方 ExportUpgrades 名称匹配：${o.officialMatched}/${o.weaponMods}（${pct(o.officialMatched, o.weaponMods)}）`,
    `等级上限人工修正：${o.rankFixes} 条`,
    `中文名缺失：${o.zhMissing.length}`,
    `武器槽位无法判定：${o.unresolvedWeapons.length}`,
    `WFCD 交叉校验：${o.wfcdNote}，比对 ${o.wfcdCrossChecked} 条，不一致 ${o.wfcdMismatch.length} 条`,
  ];
  return lines.join('\n');
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));

  console.log('[1/6] 读取 Mod 基线（Mod 数值来源）...');
  const baselineMods = loadModBaseline();
  console.log(`      ${baselinePath()}：${baselineMods.length} 条`);

  console.log('[2/6] 读取官方导出...');
  const upgrades = await fetchSource<OfficialUpgrades>('upgrades', { force: args.force });
  const weapons = await fetchSource<ExportWeapons>('weapons', { force: args.force });
  const zhDict = await fetchSource<LanguageDict>('langZh', { force: args.force });
  const enDict = await fetchSource<LanguageDict>('langEn', { force: args.force });
  const arcanesRaw = await fetchSource<Record<string, ArcaneRaw>>('arcanes', { force: args.force });
  const modSetsRaw = await fetchSource<Record<string, ModSetRaw>>('modSets', { force: args.force });
  console.log(
    `      ExportUpgrades ${Object.keys(upgrades).length}；ExportWeapons ${Object.keys(weapons).length}；` +
      `ExportArcanes ${Object.keys(arcanesRaw).length}；ExportModSet ${Object.keys(modSetsRaw).length}`,
  );

  console.log('[3/6] 建立官方 Mod 元数据索引...');
  // 英文显示名 → 官方条目。
  // 坑：官方导出里同名条目很多（Primed Pressure Point 的语言键显示名曾经就是 Pressure Point），
  // 所以按"等级上限 + 稀有度"与基线最接近的那条选，而不是简单取最高等级的一条。
  const officialByName = new Map<string, OfficialUpgrade[]>();
  for (const [uniqueName, u] of Object.entries(upgrades)) {
    if (!u.name) continue;
    const en = enDict[u.name];
    if (!en) continue;
    const candidate: OfficialUpgrade = {
      uniqueName,
      name: u.name,
      rarity: u.rarity ?? 'UNKNOWN',
      baseDrain: u.baseDrain ?? 0,
      fusionLimit: u.fusionLimit ?? 0,
      type: u.type ?? '',
      ...(u.compatName !== undefined ? { compatName: u.compatName } : {}),
      ...(u.description !== undefined ? { description: u.description } : {}),
    };
    const list = officialByName.get(en) ?? [];
    list.push(candidate);
    officialByName.set(en, list);
  }
  const RARITY_TO_OFFICIAL: Record<string, string> = {
    common: 'COMMON',
    uncommon: 'UNCOMMON',
    rare: 'RARE',
    legendary: 'LEGENDARY',
  };
  /** 在候选里挑与基线条目最吻合的一条：稀有度相同优先，再看耗点差、等级上限差 */
  function pickOfficial(enName: string, rarity: string, drain: number, maxRank: number): OfficialUpgrade | undefined {
    const list = officialByName.get(enName);
    if (!list || list.length === 0) return undefined;
    const wantRarity = RARITY_TO_OFFICIAL[rarity];
    const score = (o: OfficialUpgrade): number =>
      (wantRarity && o.rarity === wantRarity ? 0 : 100) + Math.abs(o.baseDrain - drain) + Math.abs(o.fusionLimit - maxRank) / 10;
    return list.reduce((best, cur) => (score(cur) < score(best) ? cur : best));
  }
  console.log(`      官方 Mod 英文名索引 ${officialByName.size} 个名称`);

  console.log('[4/6] 清洗 Mod...');
  const zhByName = buildZhLookup(zhDict, enDict);
  const cleaned: CleanMod[] = [];
  const unknownKeyUsage = new Map<string, StatKeyUsage>();
  const officialMissing: string[] = [];
  const zhMissing: string[] = [];
  const rankFixes: string[] = [];
  let officialMatched = 0;
  let weaponMods = 0;
  let withStats = 0;
  let arcanes = 0;
  let stances = 0;
  const excludedMods: Array<{ id: string; name: string; reason: string }> = [];

  for (const raw of baselineMods) {
    // 需求方 2026-11-06 指定的剔除清单（见 EXCLUDED_MODS）
    const excl = EXCLUDED_MODS[raw.i];
    if (excl !== undefined) {
      excludedMods.push({ id: raw.i, name: `${raw.n} ${raw.z}`, reason: excl });
      continue;
    }
    // 架势先判掉：基线的 s 字段区分不出架势，见 isStanceMod 注释
    const preMatch = officialByName.get(raw.n)?.[0];
    if (isStanceMod(raw, preMatch)) {
      stances++;
      continue;
    }
    // 需求方 2026-11-08：**37 张曲翼枪（Archgun）Mod 要入库**。
    // 基线的 `s` 字段把这些卡标成了 `'a'`（本意是"赋能"），于是以前全部被当成赋能跳过，
    // 一张都没进产物，结果空战枪械无卡可装。
    // 判据：`t === 'archgun'` 就是曲翼枪 Mod（不是赋能）——赋能从来不按 `t` 分类，
    // 它们的 `t` 是 `primary` / `melee` 这类安装位，且数值来自 `ExportArcanes.json`。
    if (raw.s === 'a' && raw.t !== 'archgun') {
      arcanes++;
      continue;
    }
    if (!isWeaponMod({ category: raw.s === 'a' ? 'g' : raw.s })) continue;
    weaponMods++;

    const official = pickOfficial(raw.n, raw.r, raw.d, raw.f);
    const { mod, unknownKeys, rankFix } = cleanMod(raw, official);
    if (rankFix !== undefined) rankFixes.push(`${raw.i}: ${rankFix}`);

    for (const k of unknownKeys) {
      const usage = unknownKeyUsage.get(k) ?? { key: k, count: 0, mods: [] };
      usage.count++;
      if (usage.mods.length < 5) usage.mods.push(raw.i);
      unknownKeyUsage.set(k, usage);
    }

    if (official) officialMatched++;
    else officialMissing.push(`${raw.i} (${raw.n})`);

    // 中文名：基线优先，缺失时用官方语言包补
    if (!mod.name.zh) {
      const alt = zhByName.get(normalizeKey(raw.n));
      if (alt) mod.name.zh = alt;
      else zhMissing.push(`${raw.i} (${raw.n})`);
    }

    if (mod.stats.length > 0) withStats++;
    cleaned.push(mod);
  }

  // 校验：每个属性键都必须有映射（防止上游新增键被静默吞掉）
  for (const k of unknownKeyUsage.keys()) {
    if (lookupStat(k) !== undefined) continue;
    console.log(`      ⚠️ 未登记属性键：${k}`);
  }
  console.log(`      武器 Mod ${weaponMods}（带数值 ${withStats}）、基线里的赋能 ${arcanes}、架势 ${stances}`);

  // ---- 赋能（官方 ExportArcanes，有结构化逐级数值）----
  const cleanArcanes: CleanArcane[] = [];
  const arcaneSkipped: Array<{ name: string; reason: string }> = [];
  for (const [key, raw] of Object.entries(arcanesRaw)) {
    const res = cleanArcane(key, raw, zhDict, enDict);
    if ('excluded' in res) {
      if (res.excluded === 'nonDamage') arcaneSkipped.push({ name: res.name, reason: res.reason });
      continue;
    }
    cleanArcanes.push(res);
  }
  console.log(`      武器赋能 ${cleanArcanes.length} 个（剔除不影响武器伤害的 ${arcaneSkipped.length} 个）`);

  // ---- 套装（官方 ExportModSet）----
  const modsBySet = new Map<string, string[]>();
  for (const m of cleaned) {
    if (!m.set) continue;
    const list = modsBySet.get(m.set) ?? [];
    list.push(m.id);
    modsBySet.set(m.set, list);
  }
  const cleanSets = cleanModSets(modSetsRaw, zhDict, enDict, modsBySet);
  console.log(`      套装 ${cleanSets.length} 个（其中 ${cleanSets.filter((s) => s.effect.bucket).length} 个影响伤害）`);

  console.log('[5/6] 解析武器 → 可装 Mod 槽位（D-152：WFCD 为主、官方导出兜底）...');
  // D-152：槽位判定改成 WFCD 为主后要先拿到 WFCD 武器数据（抓不到就整体退回官方导出）
  const wfcdWeapons = await loadWfcdWeaponIndex(args.force);
  console.log(`      ${wfcdWeapons.note}`);
  // ⚠ 这条要等 `problems` 建好之后再 push（它就是下面 `const problems` 那一行），
  //   这里先记下来，等统计区一起汇总。
  const wfcdWeaponsMissing = wfcdWeapons.index.size === 0;

  const weaponSlots: Record<
    string,
    {
      name: string;
      nameZh?: string;
      slots: SlotResolution;
      subclass?: 'launcher' | 'crossbow';
      trueBow?: boolean;
      isDualPistols?: boolean;
      /** D-152：投掷类副手（WFCD `type: 'Throwing'`），界面单列「投掷武器」 */
      isThrowing?: boolean;
      modKinds: string[];
      todo?: 'melee_specific';
      /** D-141：面板尚未收录（如暗黑分合剑的巨刃 / 双剑），可选但不可算 */
      panelPending?: boolean;
    }
  > = {};
  const unresolvedWeapons: string[] = [];

  for (const [key, w] of Object.entries(weapons)) {
    const id = key.split('/').pop() ?? key;
    // ── D-152：收录边界以 WFCD 为准 ──
    // 这个循环遍历的是**官方导出**，会把 WFCD 早已剔除的条目带回来：
    // 天工造武部件、抗原/突变原、守护武器、滑板载具、PvP 变体、重复条目（魔典）。
    // 需求方 2026-11-13：「全都清掉，全面遵守看wfcd，只有确认不了武器本身数据例如近战类型的才参考」
    // → 统一用 WFCD 的 `exclusionReason()` 判，不在这里各自手写规则。
    const wfcdHit = wfcdWeapons.index.get(id) ?? null;
    if (wfcdHit?.excluded !== undefined) continue;
    // WFCD **完全没有收录**的条目，先按 WFCD 的同一套特征判（滑板 / 部件类都不该进配装）。
    // 这些条目在 WFCD 里查不到，但特征（id 命名）照样能认出来。
    if (!wfcdHit && WFCD_ABSENT_EXCLUSION.test(id)) continue;
    const enName = w.name ? (enDict[w.name] ?? '') : '';
    // 官方导出的判定结果：既当兜底，也用来借它的**架势标签**补近战细分
    const fromExport: SlotResolution = resolveFromExport(w);
    let slots: SlotResolution = fromExport;
    // ── D-152：WFCD 为主 ──
    if (wfcdHit) {
      const byWfcd = resolveFromWfcd({
        id,
        ...(wfcdHit.type !== undefined ? { type: wfcdHit.type } : {}),
        ...(wfcdHit.file !== undefined ? { file: wfcdHit.file } : {}),
        ...(wfcdHit.productCategory !== undefined ? { productCategory: wfcdHit.productCategory } : {}),
      });
      if (byWfcd) {
        // 近战细分 WFCD 没有字段（需求方：可用官方架势兜底）→ 从官方判定里借架势标签
        const specific = byWfcd.broad === 'melee' ? meleeSpecificOf(fromExport) : [];
        slots = {
          broad: byWfcd.broad,
          specific,
          source: specific.length > 0 ? 'wfcd-type+stance' as SlotResolution['source'] : 'wfcd-type',
          basis: byWfcd.basis,
          unresolved: false,
        };
      }
    }
    // 显赫武器等两边都给不出武器类的，用人工表补
    const override = lookupExaltedSlots(enName);
    if (override) {
      slots = {
        ...slots,
        broad: override.broad,
        unresolved: false,
        source: 'manual',
      };
    }
    // D-141：人工层构造的武器版本（如暗黑分合剑的巨刃 / 双剑）在导出里没有独立条目，
    // 它们继承原条目的元数据、但**按构造时给的架势标签**判定细类与配卡。
    if (slots.unresolved) unresolvedWeapons.push(`${id} (${enName || w.name || '?'})`);
    const zhName = w.name ? zhDict[w.name] : undefined;
    const subclass = exportSubclass({ ...w, uniqueName: key });
    // 真正的弓才吃弓箭类 Mod / 弓箭·赋能；弩按步枪算（需求方 2026-07-11 确认）
    // D-152：WFCD 判定成 bow 的也算真正的弓——新武器（霜冥差）在官方导出里没有条目，
    //        `isTrueBow` 只能看官方的 holsterCategory，会漏掉它。
    //        ⚠ 必须排除弩（subclass === 'crossbow'）：弩的 WFCD type 也是 Bow，但不能吃弓箭类 Mod。
    const subclassIsCrossbow = subclass === 'crossbow';
    const trueBow = isTrueBow(w) || (slots.broad === 'bow' && !subclassIsCrossbow);
    // D-152：WFCD `type` 明确写着 Dual Pistols 的，标出来（「双枪·滑射」赋能用它判断）。
    // ⚠ 必须与双刀 / 双剑区分（需求方 2026-11-13 特别提醒）：它们 id 也带 `Dual` 前缀、
    //   官方 `DUAL_*` 标签也全挂在近战上，所以 `isDualPistolByWfcd` 内部先要求 broad === 'pistol'。
    const isDualPistols = isDualPistolByWfcd(wfcdHit?.type, id, slots.broad);
    // D-152：投掷类副手（飞刀 / 飞镖 / 苦无 / 手雷副手），界面单独归「投掷武器」。
    // Mod 池与普通副手一致（需求方：副手 Mod 通用，投掷只有个别专属靠 onlyOn 判）。
    const isThrowing = slots.broad === 'pistol' && wfcdHit?.type === 'Throwing';
    weaponSlots[id] = {
      name: enName || id,
      ...(zhName ? { nameZh: zhName } : {}),
      slots,
      // 展示用细类（发射器 / 弩）：它们吃步枪类 Mod，broad 仍是 rifle，只影响界面分组
      ...(subclass ? { subclass } : {}),
      ...(trueBow ? { trueBow } : {}),
      ...(isDualPistols ? { isDualPistols } : {}),
      ...(isThrowing ? { isThrowing } : {}),
      modKinds: compatibleModKinds(slots, trueBow),
      // 近战缺细类：显式标记，让消费方知道"这把武器只能装通用近战 Mod"
      ...(slots.broad === 'melee' && slots.specific.length === 0 && !slots.unresolved
        ? { todo: 'melee_specific' as const }
        : {}),
    };
  }
  // D-141：人工层构造的武器版本（如暗黑分合剑的巨刃 / 双剑）。
  // 需求方 2026-11-12：面板已全部来自 WFCD，只有名称与架势标签来自人工层；
  // 面板不再「待补」，所以这里不再标 `panelPending`。
  for (const v of MANUAL_VARIANTS) {
    if (weaponSlots[v.id]) continue;
    const slots = slotsFromStanceTags(v.stanceTags);
    weaponSlots[v.id] = {
      name: v.nameEn,
      nameZh: v.nameZh,
      slots,
      modKinds: compatibleModKinds(slots, false),
    };
  }

  // D-152：WFCD 有、官方导出还没有的武器（霜冥差 / 寒怨刺 / 石晶之花 Prime / 闪劫 Prime）。
  // 上面那个循环遍历的是**官方导出条目**，这四把不在里面，所以以前根本没有记录，
  // 界面就判不出它们能吃哪套 Mod。这里按 WFCD 条目补录。
  let wfcdOnly = 0;
  for (const [id, entry] of wfcdWeapons.index) {
    if (weaponSlots[id]) continue;
    // D-152：WFCD 自己判为「不收」的（天工刀身 / 滑板 / 重复条目 / 指挥官武器…），不补录。
    // 用的是 `wfcd-clean.ts` 的同一份规则，不另写一套。
    if (entry.excluded !== undefined) continue;
    const byWfcd = resolveFromWfcd({ id, ...entry });
    if (!byWfcd) continue;
    const slots: SlotResolution = {
      broad: byWfcd.broad,
      specific: [],
      source: 'wfcd-type',
      basis: byWfcd.basis,
      unresolved: false,
    };
    // 中文名：人工名称表（语言包还没收录这些新武器）
    const manualZh = MANUAL_WEAPON_ZH[id];
    weaponSlots[id] = {
      name: wfcdWeapons.nameById.get(id)?.name ?? id,
      ...(manualZh ? { nameZh: manualZh.zh } : {}),
      slots,
      ...(slots.broad === 'bow' ? { trueBow: true } : {}),
      ...(entry.type === 'Dual Pistols' ? { isDualPistols: true } : {}),
      modKinds: compatibleModKinds(slots, slots.broad === 'bow'),
    };
    wfcdOnly++;
    if (manualZh) {
      console.log(`      WFCD 补录：${id}（${weaponSlots[id].name}）→ ${manualZh.zh}：${manualZh.reason}`);
    }
  }
  if (wfcdOnly > 0) console.log(`      仅 WFCD 有、官方导出还没有的武器：${wfcdOnly} 把已补录`);

  console.log(`      武器 ${Object.keys(weaponSlots).length} 把`);
  console.log(`      槽位无法判定 ${unresolvedWeapons.length} 把`);

  // 近战细类待办（docs/decisions.md D-004：需求方确认"全部列为 todo，暂不关心"）。
  // 这些武器维持"只有宽类 melee、没有细类"，不补推断值；显式统计出来方便以后回看。
  const meleeMissingSpecific = Object.entries(weaponSlots)
    .filter(([, w]) => w.slots.broad === 'melee' && w.slots.specific.length === 0 && !w.slots.unresolved)
    .map(([id, w]) => `${id} (${w.name})`);
  console.log(
    `      近战缺细类 ${meleeMissingSpecific.length} 把（D-004 待办：显赫武器与天工造武，暂不补）`,
  );

  console.log('[6/6] 交叉校验（可选数据源）...');
  const wfcd = await loadWfcd(args.force);
  const wfcdMismatch: string[] = [];
  let wfcdCrossChecked = 0;
  if (wfcd.mods) {
    // WFCD 里同名条目可能有多条（如 "Pressure Point" 有 3 条，其中一条是旧版的
    // WeaponMeleeDamageOnHeavyKillMod，等级上限 10 但名字还没改）。所以：
    //   · 只有"同名唯一"的 Mod 才做等级上限硬校验；
    //   · 同名多条时，只要有任何一条对得上就算通过。
    const byEn = new Map<string, Record<string, unknown>[]>();
    for (const m of wfcd.mods as Record<string, unknown>[]) {
      if (typeof m['name'] !== 'string') continue;
      const key = normalizeKey(m['name'] as string);
      const list = byEn.get(key) ?? [];
      list.push(m);
      byEn.set(key, list);
    }
    let ambiguous = 0;
    for (const mod of cleaned) {
      const hits = byEn.get(normalizeKey(mod.name.en));
      if (!hits) continue;
      wfcdCrossChecked++;
      const ranks = hits.map((h) => h['fusionLimit']).filter((v): v is number => typeof v === 'number');
      if (ranks.length === 0) continue;
      if (ranks.includes(mod.maxRank)) continue;
      if (hits.length > 1) {
        ambiguous++;
        continue;
      }
      wfcdMismatch.push(`${mod.id}: 等级上限 基线=${mod.maxRank} WFCD=${ranks[0]}`);
    }
    if (ambiguous > 0) {
      console.log(`      另有 ${ambiguous} 条同名多版本，等级上限不作为硬校验`);
    }
    console.log(`      WFCD ${(wfcd.mods as unknown[]).length} 条，比对 ${wfcdCrossChecked} 条，不一致 ${wfcdMismatch.length} 条`);
  } else {
    console.log(`      ⚠️ 跳过 WFCD 交叉校验：${wfcd.note}`);
    console.log('         （GitHub 证书被本机拦截时，设置 WFCD_INSECURE_TLS=1 后可下载）');
  }

  const statsText = formatStats({
    total: baselineMods.length,
    weaponMods,
    arcanes,
    stances,
    withStats,
    unknownKeys: [...unknownKeyUsage.values()],
    officialMatched,
    officialMissing,
    zhMissing,
    unresolvedWeapons,
    wfcdNote: wfcd.note,
    wfcdCrossChecked,
    wfcdMismatch,
    rankFixes: rankFixes.length,
    weaponArcanes: cleanArcanes.length,
    arcaneSkipped: arcaneSkipped.length,
    modSets: cleanSets.length,
    damageSets: cleanSets.filter((s) => s.effect.bucket !== null).length,
  });
  console.log('\n' + statsText);

  // 合理性检查
  const problems: string[] = [];
  if (unknownKeyUsage.size > 0) problems.push(`有 ${unknownKeyUsage.size} 个属性键未登记映射，需在 stat-map.ts 补齐。`);
  if (weaponMods === 0) problems.push('武器 Mod 数为 0，上游结构可能变了。');
  if (weaponMods > 0 && officialMatched / weaponMods < 0.9) {
    problems.push(`官方匹配率 ${((officialMatched / weaponMods) * 100).toFixed(1)}% 低于 90%，名称口径可能变了。`);
  }
  if (weaponMods > 0 && withStats / weaponMods < 0.8) {
    problems.push(`带数值的 Mod 只占 ${((withStats / weaponMods) * 100).toFixed(1)}%，低于 80%。`);
  }
  if (wfcdMismatch.length > 0) problems.push(`WFCD 交叉校验有 ${wfcdMismatch.length} 条不一致，见报告。`);
  // D-152：WFCD 武器数据缺失时槽位判定全退回官方导出，必须让人看见
  if (wfcdWeaponsMissing) problems.push('WFCD 武器数据缺失，槽位判定退回了官方导出（见统计）。');

  if (problems.length > 0) {
    console.log('\n⚠️  发现以下问题，需要确认：');
    for (const p of problems) console.log(`   - ${p}`);
  } else {
    console.log('\n      合理性检查通过。');
  }

  if (!args.emit) {
    console.log('\n【dry-run】未写入任何产出。确认无误后加 --emit 重新运行。');
    return problems.length > 0 ? 1 : 0;
  }

  console.log('\n写入产出...');
  mkdirSync(MODS_DIR, { recursive: true });

  writeFileSync(
    join(MODS_DIR, 'mods.json'),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        source: 'mods/baseline.json（Mod 数值基线） + ExportUpgrades（元数据交叉校验）',
        note: 'levelValues 为 0 级到满级的逐级数值；bucket 对应 docs/乘区归属表.md 的乘区',
        count: cleaned.length,
        mods: cleaned,
      },
      null,
      2,
    ) + '\n',
  );

  writeFileSync(
    join(MODS_DIR, 'weapon-slots.json'),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        note: 'modKinds = 该武器能装备的 Mod 槽位种类（对应 mods.json 的 slotKind）',
        count: Object.keys(weaponSlots).length,
        weapons: weaponSlots,
      },
      null,
      2,
    ) + '\n',
  );

  writeFileSync(
    join(MODS_DIR, 'arcanes.json'),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        source: 'ExportArcanes.json（官方结构化逐级数值）+ dict.zh/en 渲染描述',
        note: 'levels[].values 为各级的数值槽（路径 → 数值）；bucket 对应 docs/乘区归属表.md',
        scope: '仅收录武器可用赋能（主要·/次要·/近战·/神威·/和平·/残差·/弓箭·/霰弹·/双枪·/瀑流·/联结·/分形·）',
        count: cleanArcanes.length,
        skipped: arcaneSkipped,
        arcanes: cleanArcanes,
      },
      null,
      2,
    ) + '\n',
  );

  writeFileSync(
    join(MODS_DIR, 'mod-sets.json'),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        source: 'ExportModSet.json（官方套装逐级数值）',
        note: '装 2 件及以上同系列模组生效；levels 索引 = 已装件数 - 2。私法的暴击强化按等效绝对值暴击率放在固定加算区',
        count: cleanSets.length,
        sets: cleanSets,
      },
      null,
      2,
    ) + '\n',
  );

  writeFileSync(
    join(MODS_DIR, 'index.json'),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        sources: [
          { name: 'mods/baseline.json', usage: 'Mod 数值、等级上限、互斥关系、条件效果' },
          { name: 'ExportUpgrades.json', usage: '耗点 / 稀有度 / 极性 / 官方名称 交叉校验' },
          { name: 'ExportArcanes.json', usage: '武器赋能的逐级数值（官方结构化数据）' },
          { name: 'ExportModSet.json', usage: '套装加成的逐级数值' },
          { name: 'dict.zh.json / dict.en.json', usage: '中文名补全、赋能/套装描述渲染' },
          { name: 'WFCD Mods.json', usage: '等级上限交叉校验（可选）', license: MOD_SOURCES.wfcdMods.license },
        ],
        counts: {
          weaponMods,
          arcanes: cleanArcanes.length,
          arcanesSkipped: arcaneSkipped.length,
          modSets: cleanSets.length,
          stances,
          weapons: Object.keys(weaponSlots).length,
        },
        coverage: {
          officialMatched,
          withStats,
          unresolvedWeapons: unresolvedWeapons.length,
          meleeMissingSpecific: meleeMissingSpecific.length,
          zhMissing: zhMissing.length,
        },
        todo: {
          unknownStatKeys: [...unknownKeyUsage.keys()],
          officialMissing: officialMissing.slice(0, 200),
          zhMissing: zhMissing.slice(0, 200),
          unresolvedWeapons: unresolvedWeapons.slice(0, 200),
          meleeMissingSpecific: meleeMissingSpecific.slice(0, 200),
          wfcdMismatch: wfcdMismatch.slice(0, 200),
          rankFixes: rankFixes.slice(0, 200),
          arcanesNeedingManualBucket: cleanArcanes
            .filter((a) => a.effectKind === 'special')
            .map((a) => `${a.name.zh} (${a.id})`),
        },
      },
      null,
      2,
    ) + '\n',
  );

  mkdirSync(REPORT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const report = renderReport({ statsText, cleaned, unknownKeyUsage, officialMissing, zhMissing, unresolvedWeapons, wfcdMismatch, rankFixes, cleanArcanes, arcaneSkipped, cleanSets, problems });
  writeFileSync(join(REPORT_DIR, `mods-${stamp}.md`), report);
  writeFileSync(join(REPORT_DIR, 'mods-latest.md'), report);

  console.log(`  mods.json          ${cleaned.length} 条`);
  console.log(`  arcanes.json       ${cleanArcanes.length} 个武器赋能`);
  console.log(`  mod-sets.json      ${cleanSets.length} 个套装`);
  console.log(`  weapon-slots.json  ${Object.keys(weaponSlots).length} 把武器`);
  console.log(`  报告 → ${join('packages/data/src/generated/reports', 'mods-latest.md')}`);

  return problems.length > 0 ? 1 : 0;
}

function renderReport(o: {
  statsText: string;
  cleaned: CleanMod[];
  unknownKeyUsage: Map<string, StatKeyUsage>;
  officialMissing: string[];
  zhMissing: string[];
  unresolvedWeapons: string[];
  wfcdMismatch: string[];
  rankFixes: string[];
  cleanArcanes: CleanArcane[];
  arcaneSkipped: Array<{ name: string; reason: string }>;
  cleanSets: CleanModSet[];
  problems: string[];
}): string {
  const section = (title: string, items: string[], limit = 60): string[] => {
    const out = ['', `## ${title}（${items.length}）`];
    if (items.length === 0) {
      out.push('无');
      return out;
    }
    out.push('```', ...items.slice(0, limit));
    if (items.length > limit) out.push(`…共 ${items.length} 条，仅列前 ${limit} 条`);
    out.push('```');
    return out;
  };

  // 按乘区统计覆盖
  const byBucket = new Map<string, number>();
  for (const m of o.cleaned) for (const s of m.stats) if (s.bucket) byBucket.set(s.bucket, (byBucket.get(s.bucket) ?? 0) + 1);

  return [
    `# Mod 数据更新报告 ${new Date().toISOString()}`,
    '',
    '## 统计',
    '```',
    o.statsText,
    '```',
    '',
    '## 各乘区可用的 Mod 属性条数',
    '```',
    [...byBucket.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${String(v).padStart(5)}  ${k}`).join('\n'),
    '```',
    '',
    '## 问题',
    o.problems.length ? o.problems.map((p) => `- ${p}`).join('\n') : '无',
    ...section('未登记的属性键', [...o.unknownKeyUsage.keys()]),
    ...section('等级上限被人工修正的 Mod', o.rankFixes),
    ...section('剔除的赋能（不影响武器伤害）', o.arcaneSkipped.map((a) => `${a.name}：${a.reason}`)),
    ...section(
      '赋能：乘区待人工确认',
      o.cleanArcanes.filter((a) => a.effectKind === 'special').map((a) => `${a.name.zh} (${a.id})：${a.description.zh.slice(0, 60)}`),
    ),
    ...section(
      '套装乘区归属',
      o.cleanSets.map((s) => `${s.name.zh} (${s.id})：${s.effect.kind} / ${s.effect.bucket ?? '-'} — ${s.effect.note}`),
    ),
    ...section('官方 ExportUpgrades 里找不到的 Mod', o.officialMissing),
    ...section('缺中文名的 Mod', o.zhMissing),
    ...section('槽位无法判定的武器', o.unresolvedWeapons),
    ...section('WFCD 交叉校验不一致', o.wfcdMismatch),
  ].join('\n');
}

try {
  process.exitCode = await main();
} catch (err) {
  console.error('\n❌ Mod 流程失败，已停止（未做任何写入）。');
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
}
