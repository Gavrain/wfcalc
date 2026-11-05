/**
 * 武器 → 可装备的 Mod 槽位种类（mod slot kind）。
 *
 * 为什么需要：ZKMODS 用 `t` 字段标注模组属于哪一类武器（`rifle` / `shotgun` / `bow` /
 * `nikana` / `glaive` …），而武器面板给的是 `holsterCategory` / `compatibilityTags`。
 * 两边要能对上，UI 才能"选一把武器 → 只列出它能装的 Mod"。
 *
 * 判定优先级（每一级都比上一级更权威，逐级回退，并记录依据便于排查）：
 *   1. **ZK 武器库（主）**：需求方模拟器的 `WEAPON_DB` 自带 `c`（武器类）与 `s`（主/副/近战/空战）。
 *      实测 642 把里 637 把能和官方导出对上（默认按英文名匹配），分类与游戏一致。
 *   2. **官方导出的 holsterCategory**：ZK 库里没有的新武器用它兜底
 *      （RIFLE / BOW / SHOTGUN / SNIPER / SMG / WIDE_RIFLE / PISTOL）。
 *   3. **近战 `*_STANCE` 标签**：ZK 的近战类有时只给宽类 `melee`，用标签补出细类。
 *   4. **产品大类**：Pistols → pistol，LongGuns → rifle，最后兜底。
 *
 * 注意：官方导出的手枪绝大多数没有 `holsterCategory`，霰弹类手枪（Bronco/Pyrana）
 * 更是只有 ZK 库能分辨——这也是把 ZK 库放第一位的原因。
 */
import type { ExportWeapon } from '../types.ts';

/**
 * Mod 槽位种类，与 ZKMODS 的 `t` 一一对应。
 */
export const MOD_SLOT_KINDS = [
  // 枪械宽类
  'rifle',
  'shotgun',
  'pistol',
  'primary',
  'bow',
  'sniper',
  // 近战宽类
  'melee',
  // 空战
  'archgun',
  'archmelee',
  // 显赫武器
  'exalted_weapon',
  // 典籍
  'tome',
  // 近战细类（D-001：近战专属 Mod 需要区分类型）
  'sword',
  'dual_swords',
  'nikana',
  'two_handed_nikana',
  'dual_nikanas',
  'heavy_blade',
  'heavy_scythe',
  'scythe',
  'hammer',
  'polearm',
  'staff',
  'dagger',
  'dual_daggers',
  'machete',
  'sword_and_shield',
  'claws',
  'fist',
  'sparring',
  'tonfa',
  'glaive',
  'gunblade',
  'nunchaku',
  'rapier',
  'whip',
  'blade_and_whip',
  'assault_saw',
  'warfan',
] as const;

export type ModSlotKind = (typeof MOD_SLOT_KINDS)[number];

/**
 * 近战细类（`melee` 之下再分）。
 *
 * 需求方确认（2026-11-05，见 docs/decisions.md D-001）：**近战必须区分类型**，
 * 因为近战专属 Mod 只能装在对应类型的近战武器上（如尼卡纳 Mod 不能装到剑上）。
 *
 * 归到 `melee` 宽类的通用 Mod 仍然对所有近战合法——两件事分开判断，见 `canEquipMod`。
 *
 * 注意：与 `MOD_SLOT_KINDS` 里的近战细类必须完全一致（下面的自检会保证）。
 */
const MELEE_SUBCLASSES = [
  'sword',
  'dual_swords',
  'nikana',
  'two_handed_nikana',
  'dual_nikanas',
  'heavy_blade',
  'heavy_scythe',
  'scythe',
  'hammer',
  'polearm',
  'staff',
  'dagger',
  'dual_daggers',
  'machete',
  'sword_and_shield',
  'claws',
  'fist',
  'sparring',
  'tonfa',
  'glaive',
  'gunblade',
  'nunchaku',
  'rapier',
  'whip',
  'blade_and_whip',
  'assault_saw',
  'warfan',
] as const satisfies readonly ModSlotKind[];

/** 自检：近战细类表与 MOD_SLOT_KINDS 必须一致，防止以后只改一处 */
for (const k of MELEE_SUBCLASSES) {
  if (!MOD_SLOT_KINDS.includes(k)) throw new Error(`MELEE_SUBCLASSES 里的 ${k} 不在 MOD_SLOT_KINDS 中`);
}

/** ZK 武器库里出现的 `c` 值（含几个不在 Mod 槽位种类里的枪械类） */
const ZK_CLASS_TO_KIND: Record<string, ModSlotKind | null> = {
  rifle: 'rifle',
  bow: 'bow',
  shotgun: 'shotgun',
  sniper: 'sniper',
  launcher: 'rifle', // 火箭/榴弹发射器在游戏内吃步枪类 Mod
  crossbow: 'rifle', // 弩同上
  pistol: 'pistol',
  dual_pistols: 'pistol',
  shotgun_sidearm: 'pistol', // 霰弹手枪吃手枪类 Mod
  dual_shotguns: 'pistol',
  tome: 'tome',
  archgun: 'archgun',
  archmelee: 'archmelee',
  exalted_weapon: 'exalted_weapon',
  melee: 'melee',
  // 近战细类保留自身，不再收敛（D-001）
  ...Object.fromEntries(MELEE_SUBCLASSES.map((k) => [k, k as ModSlotKind])),
};


/** ZK 武器库的 `s`（武器槽位）→ 大类 */
type ZkSlot = 'p' | 's' | 'm' | 'a' | 'e';

/** holsterCategory → 宽类槽位（第 2 级兜底） */
const HOLSTER_KINDS: Record<string, ModSlotKind> = {
  RIFLE: 'rifle',
  WIDE_RIFLE: 'rifle',
  SMG: 'rifle',
  SHOTGUN: 'shotgun',
  BOW: 'bow',
  SNIPER: 'sniper',
  PISTOL: 'pistol',
};

/** 表示"近战"的 holsterCategory 取值 */
const MELEE_HOLSTERS = new Set([
  'MELEE',
  'DUAL_MELEE',
  'SHORT_MELEE',
  'DUAL_SHORT_MELEE',
  'HIP_MELEE',
  'DUAL_HIP_MELEE',
  'FIST',
  'STAFF',
  'TONFA',
  'CLAWS',
  'PUNCH_SLASH_KICK',
]);

/**
 * 近战 `*_STANCE` 标签 → 近战细类。
 *
 * 用途：ZK 武器库对某些近战只给了宽类 `melee`，这时用官方导出的架势标签补出细类。
 * D-001 恢复近战区分后重新启用。
 */
const STANCE_TAG_TO_KIND: Record<string, ModSlotKind> = {
  SWORDS_STANCE: 'sword',
  SWORD_STANCE: 'sword',
  DUAL_SWORDS_STANCE: 'dual_swords',
  NIKANAS_STANCE: 'nikana',
  NIKANA_STANCE: 'nikana',
  TWO_HANDED_NIKANAS_STANCE: 'two_handed_nikana',
  LONG_KATANA_STANCE: 'two_handed_nikana',
  DUAL_NIKANAS_STANCE: 'dual_nikanas',
  HEAVY_BLADE_STANCE: 'heavy_blade',
  HAMMERS_STANCE: 'hammer',
  HAMMER_STANCE: 'hammer',
  POLEARMS_STANCE: 'polearm',
  POLEARM_STANCE: 'polearm',
  STAVES_STANCE: 'staff',
  STAFF_STANCE: 'staff',
  DAGGERS_STANCE: 'dagger',
  DUAL_DAGGERS_STANCE: 'dual_daggers',
  SCYTHES_STANCE: 'scythe',
  'HEAVY SCYTHE_STANCE': 'heavy_scythe',
  HEAVY_SCYTHE_STANCE: 'heavy_scythe',
  MACHETES_STANCE: 'machete',
  SWORDS_AND_SHIELD_STANCE: 'sword_and_shield',
  CLAWS_STANCE: 'claws',
  CLAWS_STANCE_STANCE: 'claws',
  CLAW_STANCE: 'claws',
  FIST_STANCE: 'fist',
  SPARRING_STANCE: 'sparring',
  TONFA_STANCE: 'tonfa',
  TONFAS_STANCE: 'tonfa',
  GLAIVES_STANCE: 'glaive',
  GUNBLADES_STANCE: 'gunblade',
  NUNCHAKU_STANCE: 'nunchaku',
  RAPIERS_STANCE: 'rapier',
  RAPIER_STANCE: 'rapier',
  WHIPS_STANCE: 'whip',
  BLADE_AND_WHIP_STANCE: 'blade_and_whip',
  WARFAN_STANCE: 'warfan',
  WARFANS_STANCE: 'warfan',
  ASSAULT_SAW_STANCE: 'assault_saw',
  WARSWORD_STANCE: 'assault_saw',
};

/** 该标签是否表示"这是近战武器" */
function isMeleeStanceTag(tag: string): boolean {
  const t = tag.toUpperCase();
  return Object.hasOwn(STANCE_TAG_TO_KIND, t) || /_STANCE(_STANCE)?$/.test(t);
}

/** ZK 武器库条目（只声明用到的字段） */
export interface ZkWeaponClass {
  /** ZK 内部 id */
  i: string;
  /** 英文名 */
  n: string;
  /** 槽位：p 主武器 / s 副武器 / m 近战 / a 空战 / e 显赫 */
  s: ZkSlot;
  /** 武器类（细分到 nikana / glaive …） */
  c?: string;
}

/** 归一化：去大小写与非字母数字，用于跨数据源匹配 */
export function normalizeKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export interface SlotResolution {
  /** 宽类（决定通用模组能不能装） */
  broad: ModSlotKind;
  /**
   * 细类（决定专属模组能不能装），没有则为空数组。
   *
   * 需求方确认（2026-11-05，见 docs/decisions.md D-001）：
   * **近战必须区分类型**——近战专属 Mod 不能用于所有近战武器。
   * 判定规则见 `usableModKinds`：宽类 `melee` 模组对所有近战合法，细类模组只对同名细类合法。
   */
  specific: ModSlotKind[];
  /** 判定依据：用哪一级得出的 */
  source: 'zk-class' | 'holster' | 'stance-tags' | 'product-category' | 'manual' | 'unresolved';
  basis: { zkClass?: string | undefined; zkSlot?: ZkSlot | undefined; holster?: string | undefined; tags: string[]; productCategory?: string | undefined };
  /** 无法判定时为 true，流水线会列入待人工确认 */
  unresolved: boolean;
}

/** 由 ZK 武器库条目判定 */
export function resolveFromZkClass(zk: ZkWeaponClass, tags: string[] = []): SlotResolution {
  const basis: SlotResolution['basis'] = { zkClass: zk.c, zkSlot: zk.s, tags };

  // 哨兵 / 猎犬武器在 ZK 库里有自己的 p/a 条目，但它们属于伙伴武器，不在本项目的配装范围
  if (tags.includes('SENTINEL_WEAPON') || tags.includes('HOUND_WEAPON')) {
    const meleeLike = zk.s === 'm';
    return { broad: meleeLike ? 'melee' : 'rifle', specific: [], source: 'unresolved', basis, unresolved: true };
  }

  if (zk.s === 'a') return { broad: 'archgun', specific: [], source: 'zk-class', basis, unresolved: false };

  const mapped = zk.c ? ZK_CLASS_TO_KIND[zk.c] : undefined;

  // 显赫武器：近战类归 melee，枪械类按细类走对应的枪（D-001 后保留细类）
  if (zk.s === 'e') {
    if (mapped === 'melee' || isMeleeSubclass(zk.c)) return { broad: 'melee', specific: [], source: 'zk-class', basis, unresolved: false };
    if (mapped && mapped !== 'exalted_weapon') return { broad: mapped, specific: [], source: 'zk-class', basis, unresolved: false };
    return { broad: 'exalted_weapon', specific: [], source: 'zk-class', basis, unresolved: true };
  }

  // 近战：宽类 melee + 细类（D-001：近战专属 Mod 要区分类型）
  if (zk.s === 'm') {
    const specific: ModSlotKind[] = [];
    if (isMeleeSubclass(zk.c)) specific.push(zk.c as ModSlotKind);
    else {
      // ZK 只给了宽类时，用官方 `*_STANCE` 标签补细类
      for (const t of tags) {
        const k = STANCE_TAG_TO_KIND[t.toUpperCase()];
        if (k && !specific.includes(k)) specific.push(k);
      }
    }
    return {
      broad: 'melee',
      specific,
      source: specific.length > 0 ? (isMeleeSubclass(zk.c) ? 'zk-class' : 'stance-tags') : 'zk-class',
      basis,
      unresolved: false,
    };
  }

  if (mapped) return { broad: mapped, specific: [], source: 'zk-class', basis, unresolved: false };
  return { broad: zk.s === 's' ? 'pistol' : 'rifle', specific: [], source: 'zk-class', basis, unresolved: true };
}

/** 是否为近战细类 */
function isMeleeSubclass(c: string | undefined): boolean {
  return c !== undefined && (MELEE_SUBCLASSES as readonly string[]).includes(c);
}

/**
 * 无 ZK 条目时，用官方导出兜底。
 */
export function resolveFromExport(w: ExportWeapon): SlotResolution {
  const tags = w.compatibilityTags ?? [];
  const holster = w.holsterCategory;
  const product = w.productCategory ?? '';
  const basis: SlotResolution['basis'] = { tags, productCategory: product };
  if (holster !== undefined) basis.holster = holster;

  if (product === 'SpaceGuns') return { broad: 'archgun', specific: [], source: 'product-category', basis, unresolved: false };
  if (product === 'SpaceMelee') return { broad: 'archmelee', specific: [], source: 'product-category', basis, unresolved: false };

  if (product === 'Melee' || product === 'DrifterMelee') {
    const specific: ModSlotKind[] = [];
    for (const t of tags) {
      const k = STANCE_TAG_TO_KIND[t.toUpperCase()];
      if (k && !specific.includes(k)) specific.push(k);
    }
    return {
      broad: 'melee',
      specific,
      source: specific.length > 0 ? 'stance-tags' : 'product-category',
      basis,
      unresolved: false,
    };
  }

  // 哨兵/猎犬武器：伙伴武器有自己的 Mod 池，不属于战甲武器配装范围。
  // 必须在 holsterCategory 判定之前拦掉——哨兵枪也有 RIFLE/SNIPER/SHOTGUN 的 holster 值。
  if (product === 'SentinelWeapons') {
    const meleeLike = MELEE_HOLSTERS.has(holster ?? '');
    return { broad: meleeLike ? 'melee' : 'rifle', specific: [], source: 'unresolved', basis, unresolved: true };
  }

  if (holster !== undefined && HOLSTER_KINDS[holster] !== undefined) {
    return { broad: HOLSTER_KINDS[holster], specific: [], source: 'holster', basis, unresolved: false };
  }

  if (product === 'Pistols') return { broad: 'pistol', specific: [], source: 'product-category', basis, unresolved: false };
  if (product === 'LongGuns') return { broad: 'rifle', specific: [], source: 'product-category', basis, unresolved: false };

  // 显赫武器（战甲技能武器）：近战类走 melee（细类由人工表补），枪械类按手枪/步枪分
  if (product === 'SpecialItems' && tags.includes('POWER_WEAPON')) {
    const meleeLike = MELEE_HOLSTERS.has(holster ?? '');
    return { broad: meleeLike ? 'melee' : 'rifle', specific: [], source: 'unresolved', basis, unresolved: true };
  }

  // Operator 增幅器等：不参与 Mod 配装
  return { broad: 'rifle', specific: [], source: 'unresolved', basis, unresolved: true };
}

/**
 * 某武器能装的模组种类集合（宽类 + 细类）。
 *
 * 规则（对应游戏内实际情况）：
 *   · 步枪系模组（`rifle`）可装到 rifle / bow / sniper 以及发射器、弩
 *   · 霰弹枪模组（`shotgun`）只装霰弹枪
 *   · 手枪模组（`pistol`）只装手枪（含霰弹手枪）
 *   · `primary` 类模组（如私法热诚）装所有枪械主武器
 *   · 近战：**宽类 `melee` 模组装所有近战；细类模组只装对应细类**（D-001）
 */
export function compatibleModKinds(slots: SlotResolution): ModSlotKind[] {
  const out = new Set<ModSlotKind>([slots.broad]);
  switch (slots.broad) {
    case 'bow':
    case 'sniper':
      out.add('rifle');
      out.add('primary');
      break;
    case 'rifle':
    case 'shotgun':
      out.add('primary');
      break;
    case 'melee':
      for (const s of slots.specific) out.add(s);
      break;
    default:
      break;
  }
  return [...out];
}

/**
 * 某个模组能否装在某武器上。
 *
 * 与 `compatibleModKinds` 的区别：这里回答"这个 Mod 的 slotKind 在不在该武器的可装集合里"。
 * 近战的关键规则（D-001）：
 *   · 宽类 `melee` 模组 → 任何近战合法
 *   · 细类 `nikana` 模组 → 只有细类含 `nikana` 的近战合法
 */
export function canEquipMod(slots: SlotResolution, modSlotKind: string): boolean {
  const kinds = compatibleModKinds(slots);
  return kinds.includes(modSlotKind as ModSlotKind);
}
