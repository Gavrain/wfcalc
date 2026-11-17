/**
 * 人工数据层：与 Mod 相关的"事实表"。
 *
 * 这些表原来是写死在 adapter 里的代码，现在按需求方 2026-11-17 的分类搬成数据：
 * 凡是"某个 Mod / 某类 Mod 实际是什么效果"的判断，都属于**数据**，不属于转换逻辑。
 * 转换逻辑在 packages/core/src/input/mod.ts。
 *
 * 依据：核心事实 §11（数据层给内核的结构化事实）。
 */
import type { Faction } from '../../../core/src/contributions.ts';

export const SEMI_CANNONADE_MODS: ReadonlySet<string> = new Set([
  'semi_pistol_cannonade',
  'semi_rifle_cannonade',
  'semi_shotgun_cannonade',
]);

/** 该 Mod 是否属于"只能装纯半自动武器"的半自动炮轰系列 */

export const LOCKS_MULTISHOT_MODS: ReadonlySet<string> = new Set(['primary_acuity', 'pistol_acuity']);

/** 判定所需的武器射击模式（只取需求方关心的字段） */
export interface TriggerModeLike {
  trigger: string;
  /** 灵化模式（`role === 'incarnon'`）不参与判定 */
  role?: string;
}

/**
 * 半自动炮轰系列的可装备性：**只考虑武器本身的射击模式**。
 *
 * 需求方 2026-11-06：
 * > 「半自动系列 mod 只能装备在只有一个射击模式，且该射击模式为半自动的武器上。
 * > 注意，只考虑武器本身的射击模式，不考虑灵化模式的射击模式，因为灵化模式是后面附加到武器上的。」
 *
 * 所以先把 `role === 'incarnon'` 的模式**剔掉**，剩下的必须**恰好 1 个**且 `trigger === 'semi'`。
 *
 * 例：Paris（普通/蓄力/灵化）→ 剔掉灵化后仍有 2 个 → 不能装；
 *     Torid（semi + unknown）→ 2 个 → 不能装；Rubico（只有 1 个 semi）→ 能装。
 */

export const COMBO_SCALED_STATS: Readonly<Record<string, 'critChance' | 'statusChance'>> = {
  critChancePerCombo: 'critChance',
  statusChancePerCombo: 'statusChance',
};

/** 连击倍率默认值（需求方：「默认 12x」；带凯旋之爪满层为 13x） */

export const UNBOUNDED_STACK_MODS: Readonly<Record<string, number>> = {
  clip_delegation: 15, // 弹能过继：每层 15%（满级） × 15 层 = +225% 触发 / +225% 多重
};

/** 一张 Mod 的叠层倍数（默认 1 = 原样使用数据值） */

export const FACTION_BY_MOD_ID: Readonly<Record<string, Faction>> = {
  bane_of_corpus: 'corpus',
  primed_bane_of_corpus: 'corpus',
  bane_of_grineer: 'grineer',
  primed_bane_of_grineer: 'grineer',
  bane_of_infested: 'infested',
  primed_bane_of_infested: 'infested',
  bane_of_orokin: 'orokin',
  primed_bane_of_orokin: 'orokin',
  bane_of_the_murmur: 'murmur',
  primed_bane_of_the_murmur: 'murmur',
  // D-163：1999 势力的派系歧视 Mod（需求方 2026-11-12：「对应的派系歧视mod是存在的」）
  bane_of_techrot: 'techrot',
  primed_bane_of_techrot: 'techrot',
  bane_of_scaldra: 'scaldra',
  primed_bane_of_scaldra: 'scaldra',
  // 毁灭 / 驱逐 / 净化 系列：按卡名里的派系归类；牺牲系列是 Sentient（S 系，与 Orokin 不同系）
  // 需求方 2026-11-17：「S系，跟O不是一个系」
  primed_smite_corpus: 'corpus',
  primed_smite_corrupted: 'orokin', // 堕落者是 Orokin 派系
  primed_smite_grineer: 'grineer',
  primed_smite_infested: 'infested',
  primed_smite_the_murmur: 'murmur',
  sacrificial_pressure: 'sentient',
  sacrificial_steel: 'sentient',
  smite_corpus: 'corpus',
  smite_grineer: 'grineer',
  smite_infested: 'infested',
  smite_orokin: 'orokin',
  smite_the_murmur: 'murmur',
  expel_corpus: 'corpus',
  expel_grineer: 'grineer',
  expel_infested: 'infested',
  expel_orokin: 'orokin',
  expel_the_murmur: 'murmur',
  primed_expel_corpus: 'corpus',
  primed_expel_grineer: 'grineer',
  primed_expel_infested: 'infested',
  primed_expel_orokin: 'orokin',
  primed_expel_the_murmur: 'murmur',
  cleanse_corpus: 'corpus',
  cleanse_grineer: 'grineer',
  cleanse_infested: 'infested',
  cleanse_orokin: 'orokin',
  cleanse_the_murmur: 'murmur',
  primed_cleanse_corpus: 'corpus',
  primed_cleanse_grineer: 'grineer',
  primed_cleanse_infested: 'infested',
  primed_cleanse_orokin: 'orokin',
  primed_cleanse_the_murmur: 'murmur',
};


export const GENERIC_COMPAT = new Set([
  'RIFLE', 'PRIMARY', 'SHOTGUN', 'PISTOL', 'SECONDARY', 'MELEE', 'WARFRAME',
  'ARCHWING', 'ARCH-GUN', 'ARCHGUN', 'ARCH-MELEE', 'ARCHMELEE', 'SENTINEL', 'COMPANION',
  'KITGUN', 'RAILJACK', 'NECRAMECH', 'PLEXUS', 'AURA', 'EXILUS',
]);

export interface WeaponLike {
  id: string;
  name?: string;
  nameZh?: string;
  /** 导出里的唯一名，形如 `/Lotus/Weapons/Tenno/Rifle/Rifle` */
  uniqueName?: string;
}


/**
 * WFCD 的 `compatName` 里**武器类别**（复数形式）→ 我们武器槽位上的细类。
 *
 * 依据：核心事实 §11（可装判定读数据给的结构化字段）。
 * · 近战细类取值见 weapon-slots.json 的 `slots.specific`（dagger / polearm / whip …）；
 * · 没列在这里的 compatName 一律当作"具体武器名"处理。
 */
export const COMPAT_CLASS_TO_SPECIFIC: Readonly<Record<string, readonly string[]>> = {
  Daggers: ['dagger'],
  'Dual Daggers': ['dual_daggers'],
  'Dual Swords': ['dual_swords'],
  Polearms: ['polearm'],
  Whips: ['whip'],
  'Blade And Whip': ['blade_and_whip'],
  Claws: ['claws'],
  Fists: ['fist'],
  Hammers: ['hammer'],
  'Heavy Blade': ['heavy_blade'],
  Machetes: ['machete'],
  Nikanas: ['nikana'],
  Nunchaku: ['nunchaku'],
  Rapiers: ['rapier'],
  Scythes: ['scythe'],
  Sparring: ['sparring'],
  Staves: ['staff'],
  Swords: ['sword'],
  'Sword And Shield': ['sword_and_shield'],
  Tonfas: ['tonfa'],
  Warfans: ['warfan'],
  Glaives: ['glaive'],
  'Thrown Melee': ['glaive'],
};
