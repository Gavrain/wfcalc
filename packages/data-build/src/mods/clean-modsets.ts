/**
 * 套装加成清洗。
 *
 * 游戏机制：同一系列模组装 **2 件及以上** 时，额外生效一层"套装加成"，
 * 效果强度由**已装件数**决定（逐级数值见官方 `ExportModSet.json`）。
 *
 * 需求方确认（2026-11-05）：
 *   · 套装**要收录**（之前是我误判为"游戏里没有"）；
 *   · **私法（Vigilante）**："X% 几率强化主武器暴击"——经需求方实测，
 *     等价于**增加绝对值的暴击率**，且作用位置在 **Mod 之后**，
 *     属于「固定加算值」区（见乘区归属表 2.0：`(面板值 × (1+ΣMod%) + 固定加算值) × 额外乘区`）。
 *
 * 其余套装的乘区归属见 `SET_EFFECTS` 表，逐条人工标注。
 */
import type { BucketId } from '../../../core/src/buckets.ts';
import { collectValues, type ArcaneLevel } from './clean-arcanes.ts';

/** 套装效果的乘区归属标注 */
export interface SetEffect {
  /** 作用方式 */
  kind:
    | 'critChanceFlat' // 固定加算的暴击率（私法）
    | 'critChancePerCombo' // 每层连击增加暴击率（角斗士）
    | 'enhanceOwnMods' // 增强本套模组自身数值（牺牲 / Umbra）
    | 'slamDamage'
    | 'statusChance'
    | 'damageReduction'
    | 'companionDamage'
    | 'energyToShield'
    | 'other';
  /** 落到哪个乘区；null = 不进伤害汇总 */
  bucket: BucketId | null;
  /** 说明 / 计算口径 */
  note: string;
}

/**
 * 逐个套装的乘区归属（人工标注）。
 * key = 官方套装键（ExportModSet 路径末段去掉 SetMod）
 *
 * 依据：`ExportModSet.json` 的英文描述 + 游戏内实际效果。
 */
export const SET_EFFECTS: Readonly<Record<string, SetEffect>> = {
  // "|STAT1|% chance to enhance Critical Hits from Primary Weapons"
  // → 需求方实测：等价于增加绝对值暴击率，放在 Mod 之后的固定加算区
  Vigilante: {
    kind: 'critChanceFlat',
    bucket: 'critChance',
    note: '私法：按几率强化主武器暴击，等效为「固定加算区」的绝对暴击率（第 2.0 节的 +固定加算值）',
  },
  // "|STAT1|% Melee Critical Chance per Combo Multiplier"
  Gladiator: {
    kind: 'critChancePerCombo',
    bucket: 'critChance',
    note: '角斗士：每层连击倍率增加近战暴击率，同样走暴击率乘区（与急进猛突同类）',
  },
  // "Enhance mods in this set."
  Sacrifice: { kind: 'enhanceOwnMods', bucket: null, note: '牺牲：提高本套 Mod 自身数值（压迫点/斩铁），按比例放大本体效果' },
  Umbra: { kind: 'enhanceOwnMods', bucket: null, note: 'Umbra：提高本套 Mod 自身数值' },
  Nira: { kind: 'slamDamage', bucket: 'baseDamage', note: 'Nira：增加震地攻击伤害' },
  Boreal: { kind: 'damageReduction', bucket: null, note: 'Boreal：空中受到的伤害减免，不影响输出' },
  Spider: { kind: 'damageReduction', bucket: null, note: 'Spider：壁面攀附期间伤害减免，不影响输出' },
  Raptor: { kind: 'other', bucket: null, note: 'Raptor：空中免疫击倒几率' },
  Hawk: { kind: 'other', bucket: null, note: 'Hawk：飞身瞄准后的睡眠，控制效果' },
  Amar: { kind: 'other', bucket: null, note: 'Amar：重击瞬移，位移效果' },
  Ashen: { kind: 'other', bucket: null, note: 'Ashen：降低敌人精准度+免疫异常，防御效果' },
  Augur: { kind: 'energyToShield', bucket: null, note: 'Augur：能量转护盾，属战甲生存层' },
  Hunter: { kind: 'companionDamage', bucket: null, note: 'Hunter：只提升同伴伤害，不影响玩家武器' },
  Mecha: { kind: 'other', bucket: null, note: 'Mecha：同伴标记与异常扩散' },
  Tek: { kind: 'other', bucket: null, note: 'Tek：地面区域伤害，独立结算' },
  Synth: { kind: 'other', bucket: null, note: 'Synth：收起武器时自动装填，手感' },
  Strain: { kind: 'other', bucket: null, note: 'Strain：召唤蛆虫，同伴层' },
  Femur: { kind: 'other', bucket: null, note: 'Femur：击飞敌人死亡爆炸，独立伤害源' },
  Boneblade: { kind: 'other', bucket: null, note: 'Boneblade：震地生成卷须，独立伤害源' },
};

export interface CleanModSet {
  /** 官方套装键（Vigilante / Gladiator …） */
  id: string;
  name: { en: string; zh: string };
  /** 该套装共有几个模组 */
  modCount: number;
  /** 属于该套装的模组 id（来自 Mod 基线的 `st` 字段） */
  memberMods: string[];
  effect: SetEffect;
  /** 满级描述 */
  description: { en: string; zh: string };
  /** 按「已装件数」的逐级数值；索引 = 件数 - 2（2 件起生效） */
  levels: ArcaneLevel[];
}

/** 套装键 → 中文名（官方语言包不给套装名，用模组名的前缀推） */
const SET_NAME_ZH: Record<string, string> = {
  Vigilante: '私法',
  Gladiator: '角斗士',
  Sacrifice: '牺牲',
  Umbra: 'Umbra',
  Nira: 'Nira',
  Boreal: 'Boreal',
  Spider: 'Spider',
  Raptor: 'Raptor',
  Hawk: 'Hawk',
  Amar: 'Amar',
  Ashen: 'Ashen',
  Augur: '预言',
  Hunter: '猎人',
  Mecha: 'Mecha',
  Tek: '技法',
  Synth: '合成',
  Strain: '菌株',
  Femur: 'Femur',
  Boneblade: 'Boneblade',
};

/**
 * 把套装描述里的占位符（`|STAT1|` / `|val|`）换成该件数对应的数值。
 *
 * 注意：ExportModSet 的 levelStats 是**扁平对象**（`{ STAT1: "30" }`），
 * 描述文本是**另一个语言键**，两者靠占位符名字对上——这和赋能的结构不同。
 */
export function renderSetDescription(
  template: string | undefined,
  levelStat: Record<string, unknown> | undefined,
  dict: Record<string, string>,
): string {
  const tpl = template ? (dict[template] ?? template) : '';
  if (!tpl) return '';
  let out = tpl;
  for (const [k, v] of Object.entries(levelStat ?? {})) {
    if (typeof v !== 'string' && typeof v !== 'number') continue;
    for (const form of [k, k.toLowerCase(), k.toUpperCase()]) {
      out = out.split(`|${form}|`).join(String(v));
    }
  }
  return out.replace(/\s+/g, ' ').trim();
}

/** 清洗全部套装 */
export function cleanModSets(
  raw: Record<string, { description?: string; numUpgradesInSet?: number; levelStats?: unknown[] }>,
  dictZh: Record<string, string>,
  dictEn: Record<string, string>,
  modsBySet: Map<string, string[]>,
): CleanModSet[] {
  const out: CleanModSet[] = [];
  for (const [key, v] of Object.entries(raw)) {
    const id = (key.split('/').pop() ?? key).replace(/SetMod$/, '');
    const effect = SET_EFFECTS[id];
    if (!effect) continue;

    const ls = (v.levelStats ?? []) as unknown[];
    const levels: ArcaneLevel[] = ls.map((lv, i) => ({ rank: i, values: collectValues(lv) }));
    const last = (ls.at(-1) ?? {}) as Record<string, unknown>;

    out.push({
      id,
      name: { en: id, zh: SET_NAME_ZH[id] ?? id },
      modCount: v.numUpgradesInSet ?? 0,
      memberMods: modsBySet.get(id) ?? [],
      effect,
      description: {
        en: renderSetDescription(v.description, last, dictEn),
        zh: renderSetDescription(v.description, last, dictZh),
      },
      levels,
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}
