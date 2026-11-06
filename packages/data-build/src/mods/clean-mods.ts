/**
 * Mod 清洗：把 ZKMODS 原始条目 + 官方 ExportUpgrades 元数据，合成一份可直接进计算内核的模型。
 *
 * 数值口径（从紫卡模拟器实测反推，多个模组交叉验证一致）：
 *   · `p[][1]` 是【满级值】，0 级为 0，各级线性递增：
 *         第 r 级值 = 满级值 × r / 等级上限
 *     （Serration f=10 → 每级 16.5；Point Strike f=5 → 每级 30；Hornet Strike f=10 → 每级 22）
 *   · `p[][2]` 若存在则是【明确的每级加量】，覆盖上面的线性推算
 *     （Galvanized Steel：每级 +30% 暴伤，满级 300%）
 *   · `f` = 等级上限（0 表示无等级）
 * 这几条会在产出时逐一落成 `levelValues` 数组，计算内核不需要再推算。
 */
import type { ZkMod, ZkBg } from './zk-source.ts';
import { MOD_VALUE_OVERRIDES, coOverloadPerStack, lookupStat, type StatMapping } from './stat-map.ts';

/** 清洗后的单个属性加量 */
export interface ModStatValue {
  /** ZKMODS 原始属性键，便于回溯 */
  key: string;
  stat: string;
  bucket: string | null;
  unit: 'percent' | 'flat' | 'multiplier';
  kind: 'normal' | 'functional' | 'conditional' | 'special' | 'skip';
  /** 0 级 → 满级 的逐级数值 */
  levelValues: number[];
  note?: string;
}

/** 条件 / 触发效果（来自 ZKMODS 的 bg 字段） */
export interface ModCondition {
  kind: string;
  trigger?: string;
  condition?: string;
  group?: string;
  maxStacks?: number;
  durationSeconds?: number;
  /** 条件生效时提供的属性与数值 */
  stat?: string;
  value?: number;
  mechanic?: string;
}

export interface CleanMod {
  id: string;
  name: { en: string; zh: string };
  /** 槽位种类（可装到哪类武器） */
  slotKind: string;
  /** 宽类：gun / melee / arcane / stance */
  category: string;
  maxRank: number;
  /** 满级耗点 */
  drain: number;
  rarity: 'common' | 'uncommon' | 'rare' | 'legendary' | 'unknown';
  polarity: string;
  /** 官方元信息（按英文名从 ExportUpgrades 匹配到的第一条） */
  official?: {
    uniqueName: string;
    rarity: string;
    baseDrain: number;
    fusionLimit: number;
    type: string;
    compatName?: string;
    descriptionKey?: string;
  };
  stats: ModStatValue[];
  conditions: ModCondition[];
  /** 同族互斥（只能装一个） */
  exclusiveGroup?: string;
  /** 与本体互斥的其它模组 */
  conflictsWith?: string[];
  /** 只能装在这些 ZK 武器 id 上 */
  onlyOn?: string[];
  /** 不能装在以下特征/武器上 */
  excludedFrom?: string[];
  /** 套装 id */
  set?: string;
  /** 集团 */
  syndicate?: string;
  descriptionEn: string;
  /** 原表里的人工备注 */
  noteZh?: string;
}

const RARITY: Record<string, CleanMod['rarity']> = { c: 'common', r: 'uncommon', n: 'rare', l: 'legendary' };

/**
 * 逐级数值。
 * @param maxValue 满级值
 * @param maxRank  等级上限（0 表示没有等级，只有一个数值，不展开成 0）
 * @param perRank  每级加量（可选，给了就以它为准）
 */
export function levelValues(maxValue: number, maxRank: number, perRank?: number): number[] {
  const n = Math.max(0, Math.trunc(maxRank));
  if (n === 0) return [round4(maxValue)];
  const step = perRank !== undefined ? perRank : maxValue / n;
  const out: number[] = [];
  for (let r = 0; r <= n; r++) out.push(round4(step * r));
  return out;
}

/** 四舍五入到 4 位，消掉浮点尾巴（0.30000000000000004） */
export function round4(v: number): number {
  return Math.round(v * 1e4) / 1e4;
}

/** 该卡"每个异常状态"能叠几层：取 `bg` 里 `g='condition_overload'` 的 `st`；没有（异况超量）即 1 */
function coStacks(raw: ZkMod): number {
  const hits = (raw.bg ?? []).filter((b) => b.g === 'condition_overload' && typeof b.st === 'number' && b.st > 0);
  return hits.length ? Math.max(...hits.map((h) => h.st as number)) : 1;
}

/** bg → ModCondition */
function toCondition(bg: ZkBg): ModCondition {
  const c: ModCondition = { kind: bg.k };
  if (bg.tr !== undefined && bg.tr !== '') c.trigger = bg.tr;
  if (bg.cd !== undefined && bg.cd !== '') c.condition = bg.cd;
  if (bg.g !== undefined) c.group = bg.g;
  if (bg.st !== undefined) c.maxStacks = bg.st;
  if (bg.du !== undefined) c.durationSeconds = bg.du;
  if (bg.gk !== undefined) c.stat = bg.gk;
  if (bg.gv !== undefined) c.value = bg.gv;
  if (bg.mk !== undefined) c.mechanic = bg.mk;
  return c;
}

export interface CleanModResult {
  mod: CleanMod;
  /** 无法识别的属性键（交给人工确认，不静默丢弃） */
  unknownKeys: string[];
  /** 等级上限被人工修正过时的说明 */
  rankFix?: string;
}

/** 清洗单个模组 */
export function cleanMod(raw: ZkMod, official?: CleanMod['official']): CleanModResult {
  const stats: ModStatValue[] = [];
  const unknownKeys: string[] = [];
  const maxRank = effectiveMaxRank(raw);
  const rankFix = RANK_FIXUPS[raw.i]?.reason;

  for (const entry of raw.p) {
    const key = entry[0];
    const map: StatMapping | undefined = lookupStat(key);
    if (!map) {
      unknownKeys.push(key);
      continue;
    }
    // 镀层 / 异况类（`co`）：**满层值 = 每层值 × 叠层上限**，每层值按 Mod 描述确认
    // （需求方 2026-11-06：步枪才能是一层 40 最多两层所以 80，其余看描述）。
    // ZKMODS 的 p[][1] 是各卡自己的数值（20/30/80），不能当成"每层"。
    // 产出的是**每层值**（不乘叠层上限）：内核 `overForStacks` 会乘 y，
    // 数据层再乘一次就等于把 y 算了两次（需求方 2026-11-06 指出）。
    const perStack = coOverloadPerStack(raw.i);
    const maxValue = perStack !== null ? perStack : MOD_VALUE_OVERRIDES[raw.i]?.maxValue ?? entry[1];
    const values = levelValues(maxValue, maxRank, perStack !== null ? undefined : entry[2]);
    const base: ModStatValue = {
      key,
      stat: map.stat,
      bucket: map.bucket,
      unit: map.unit,
      kind: map.kind,
      levelValues: values,
    };
    if (map.note !== undefined) base.note = map.note;
    stats.push(base);
  }

  // 弹匣的百分比加量在游戏里是"面板弹匣 × (1+X%)"后向上取整，这里只给原始百分比，
  // 取整交给计算内核（不同武器的取整时机不同，不能在这里压平）。
  const mod: CleanMod = {
    id: raw.i,
    name: { en: raw.n, zh: raw.z },
    slotKind: raw.t,
    category: raw.s,
    maxRank,
    drain: raw.d,
    rarity: RARITY[raw.r] ?? 'unknown',
    polarity: raw.y,
    stats,
    conditions: (raw.bg ?? []).map(toCondition),
    descriptionEn: raw.de,
  };
  if (official) mod.official = official;
  if (raw.fam !== undefined) mod.exclusiveGroup = raw.fam;
  if (raw.inc !== undefined && raw.inc.length > 0) mod.conflictsWith = raw.inc;
  if (raw.ex !== undefined && raw.ex.length > 0) mod.onlyOn = raw.ex;
  if (raw.ew !== undefined && raw.ew.length > 0) mod.excludedFrom = raw.ew;
  if (raw.st !== undefined) mod.set = raw.st;
  if (raw.sg !== undefined) mod.syndicate = raw.sg;
  if (raw.dz !== undefined) mod.noteZh = raw.dz;

  const result: CleanModResult = { mod, unknownKeys };
  if (rankFix !== undefined) result.rankFix = rankFix;
  return result;
}

/** 只保留"能装到某类武器上的 Mod" */
export function isWeaponMod(m: { category: string }): boolean {
  return m.category === 'g' || m.category === 'm';
}

/**
 * 判断是否架势（Stance）。
 *
 * 踩过的坑：ZKMODS 的 `s` 字段**区分不出架势**——实测 68 个架势里大多标成 `m`（近战），
 * 少数标成 `p`，而 `p` 里又混着真正的普通模组（如并合锐卡斯斩铁）。可靠信号有两个：
 *   1. 官方 ExportUpgrades 的 `type === 'STANCE'`
 *   2. ZKMODS 自身特征：**没有属性数值**（`p` 为空）+ 近战槽位 + 描述不含 `+X`
 * 不能只用描述文本——有些架势的描述里完全不含 "Stance" 字样（如 Cleaving Whirlwind）。
 */
export function isStanceMod(
  raw: { t: string; de: string; p: Array<[string, number, number?]> },
  official?: { type: string } | undefined,
): boolean {
  if (official?.type === 'STANCE') return true;
  if (/^\s*Stance\b/i.test(raw.de)) return true;
  // 没有属性数值、且不是"有加成的模组"，才可能是架势
  return raw.p.length === 0 && !/[+±]\d/.test(raw.de);
}

/**
 * 归一化等级上限。
 *
 * ZKMODS 的 `f` 等于"等级上限（rank）"，但有 12 个模组写成了 1，而它们的
 * 满级值实际是"每级加量"（与 WFCD 的等级文本逐级核对一致）：
 *   Amanata Pressure 每级 +55% → 满级 +330%
 *   Static Discharge 每级 +10% → 满级 +80%
 * 判定：`f === 1` 且该模组带 `dz` 人工备注或属于已知清单时，按 WFCD 的等级数修正。
 */
export const RANK_FIXUPS: Readonly<Record<string, { maxRank: number; reason: string }>> = {
  amanata_pressure: { maxRank: 5, reason: '原表 f=1 但数值是每级 +55%，满级 +330%，与 WFCD 6 级文本一致' },
  amalgam_furax_body_count: { maxRank: 5, reason: '原表 f=1，WFCD 为 6 级（0~5）' },
  amalgam_ripkas_true_steel: { maxRank: 5, reason: '原表 f=1，WFCD 为 6 级（0~5）' },
  blazing_pillage: { maxRank: 5, reason: '原表 f=1，WFCD 为 6 级（0~5）' },
  blade_of_truth: { maxRank: 3, reason: '原表 f=1，WFCD 为 4 级（0~3）' },
  bright_purity: { maxRank: 3, reason: '原表 f=1，WFCD 为 4 级（0~3）' },
  burning_hate: { maxRank: 5, reason: '原表 f=1，WFCD 为 6 级（0~5）' },
  entropy_detonation: { maxRank: 3, reason: '原表 f=1，WFCD 为 4 级（0~3）' },
  entropy_flight: { maxRank: 3, reason: '原表 f=1，WFCD 为 4 级（0~3）' },
  gleaming_blight: { maxRank: 3, reason: '原表 f=1，WFCD 为 4 级（0~3）' },
  hunter_bonesaw: { maxRank: 5, reason: '原表 f=1，WFCD 为 6 级（0~5）' },
  justice_blades: { maxRank: 3, reason: '原表 f=1，WFCD 为 4 级（0~3）' },
  rift_strike: { maxRank: 5, reason: '原表 f=1，WFCD 为 6 级（0~5）' },
  sentient_incision: { maxRank: 5, reason: '原表 f=1，WFCD 为 6 级（0~5）' },
  static_discharge: { maxRank: 5, reason: '原表 f=1，WFCD 为 6 级（0~5）' },
  toxic_blight: { maxRank: 3, reason: '原表 f=1，WFCD 为 4 级（0~3）' },
  vulcan_blitz: { maxRank: 5, reason: '原表 f=1，WFCD 为 6 级（0~5）' },
};

/** 取修正后的等级上限 */
export function effectiveMaxRank(raw: { i: string; f: number }): number {
  const fix = RANK_FIXUPS[raw.i];
  return fix ? fix.maxRank : raw.f;
}
