/**
 * 武器 → 可装备的 Mod 槽位种类（mod slot kind）。
 *
 * 为什么需要：Mod 基线用 `t` 字段标注模组属于哪一类武器（`rifle` / `shotgun` / `bow` /
 * `nikana` / `glaive` …），而武器面板给的是 `holsterCategory` / `compatibilityTags`。
 * 两边要能对上，UI 才能"选一把武器 → 只列出它能装的 Mod"。
 *
 * 判定只用**官方导出**，逐级回退，并记录依据便于排查：
 *   1. **产品大类**：SpaceGuns → archgun，SpaceMelee → archmelee，Melee / DrifterMelee → melee
 *   2. **holsterCategory**：RIFLE / WIDE_RIFLE / SMG / SHOTGUN / SNIPER / BOW / PISTOL …
 *      （官方导出的手枪大多没有 `holsterCategory`，靠下一级兜底）
 *   3. **近战 `*_STANCE` 标签**：补出近战细类（剑 / 锤 / 匕首 …）
 *   4. 都拿不到 → `unresolved`，列入待人工确认（显赫武器走 `manual/exalted-slots.ts`）
 *
 * 官方导出给不出 launcher / crossbow 这种展示细类（它们本来就吃步枪类 Mod），
 * 由 `exportSubclass` 单独判定，只影响界面分组，不影响可装 Mod。
 */
import type { ExportWeapon } from '../types.ts';

/**
 * Mod 槽位种类，与 Mod 基线的 `t` 一一对应。
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

/** 武器类 `c` 值（含几个不在 Mod 槽位种类里的枪械类） */
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


/** 武器槽位 `s`（主 / 副 / 近战 / 空战 / 显赫） */
type ZkSlot = 'p' | 's' | 'm' | 'a' | 'e';

/**
 * holsterCategory / 官方 `type` 的**细类**（只用于展示分组，不影响 Mod 槽位）。
 *
 * 游戏里发射器（火箭/榴弹/炮）和弩都吃步枪类 Mod，所以 Mod 槽位一律按 `rifle` 算；
 * 但界面上的"主要武器"要按类型分开（需求方 2026-11-06：下拉栏类别内再按类型分类）。
 * 官方导出里没有 launcher / crossbow 这种类型名，按**命名**、携带方式与武器特性判定。
 */
const SUBCLASS_BY_TYPE: Record<string, 'launcher' | 'crossbow'> = {
  RocketLauncher: 'launcher',
  GrenadeLauncher: 'launcher',
  Crossbow: 'crossbow',
};
/** 英文名 / 内部 id 里的发射器信号（以爆炸弹药为主的主武器） */
const LAUNCHER_NAME = /launcher|grenade|rocket|torid/i;
/** 弩的**型号名**（阿提卡 / 诸葛连弩 / 噬蛇弩 / 弩炮），按字母词边界匹配（"Zhuge Prime" 也算） */
const CROSSBOW_MODEL = /(?<![a-z])(attica|zhuge|nagantaka|ballistica)(?![a-z])/i;
/** 名字里不带信号、但以爆炸弹药为主的主武器（沙皇 / 赤毒·沙皇 / 赤毒·布拉玛） */
const EXPLOSIVE_NAME = /zarr|bramma/i;
/** 没写英文名时，用内部 id 兜底识别这几把 */
const EXPLOSIVE_ID = /GrnCannonWeapon|KuvaZarr|GrnBowWeapon|BioWeapon/i;

/**
 * 是否带**弩**信号（只看显示名、资源末段、标签）。
 *
 * 官方数据里弩的写法各不相同，逐条判：
 *   · 资源末段是 `*Crossbow` / `*Xbow`（诸葛连弩 RepeatingCrossbow、阿提卡 TnoPrmryXbowWeapon）
 *   · 显示名命中弩的型号词（阿提卡 Attica / 诸葛连弩 Prime / 噬蛇弩 Nagantaka / 弩炮 Ballistica），
 *     因为显示名是英文短语（"Zhuge Prime"），所以按词边界判，不能用整词相等
 *   · 带 `CROSSBOW` 标签
 * ⚠ 不要写成 `/crossbow|(?<![a-z])(attica|...)/i` 这种一条式：`|` 让 `crossbow` 分支不受边界保护，
 * 而资源目录名 `.../Pistol/CrossBow` 正是**螺钉手枪 Bolto**。所以**只看末段**，不看全路径。
 */
function crossbowSignalOf(name: string, idTail: string, tags: string[]): boolean {
  if (tags.includes('CROSSBOW')) return true;
  // 资源末段以 Crossbow / Xbow 结尾（诸葛连弩 RepeatingCrossbow、阿提卡 TnoPrmryXbowWeapon）
  const tail = idTail.toLowerCase();
  if (tail.endsWith('crossbow') || tail.endsWith('xbow')) return true;
  return CROSSBOW_MODEL.test(name);
}

/** 判定展示用细类（launcher / crossbow）；不是这两类返回 null */
export function exportSubclass(w: ExportWeapon): 'launcher' | 'crossbow' | null {
  const byType = w.type !== undefined ? SUBCLASS_BY_TYPE[w.type] : undefined;
  if (byType) return byType;

  // ⚠ 只看**显示名 / 内部 id 末段 / 携带方式 / 标签**，不要拼 `uniqueName` 全路径：
  //   全路径里带资源目录名（`.../Pistol/CrossBow` 其实是 螺钉手枪 Bolto），会把武器认错。
  const idTail = (w.uniqueName ?? '').split('/').pop() ?? '';
  const name = w.name ?? '';
  const key = `${name} ${idTail}`;
  const tags = w.compatibilityTags ?? [];

  // 弩：显示名 / 资源末段里有弩信号（诸葛连弩、阿提卡、噬蛇弩、弩炮，或 `Xbow` 缩写），
  // 或带 `CROSSBOW` 标签。
  // ⚠ 排除"真正的弓"：名字里的 Bow 必须是**独立词**（`Xxx Bow` / 末段 `...Bow`）。
  //   不能用 `/bow$/` —— `CrossBow` 自己就以 `bow` 结尾，会把所有弩都排除掉。
  // ⚠ 槽位约束：箭速弩只有主手（`productCategory` 为 LongGuns 或空）。副手位没有"弩"这一类，
  //   而螺钉手枪 Bolto / 弩炮 Ballistica 的资源末段恰好也叫 `CrossBow`，只靠命名分不开。
  const isBowNamed = /(?<![a-z])bow$/i.test(name.trim()) || /(?<![a-z])bow$/i.test(idTail);
  const primarySlot = w.productCategory === undefined || w.productCategory === 'LongGuns';
  if (primarySlot && !isBowNamed && crossbowSignalOf(name, idTail, tags)) return 'crossbow';

  if (LAUNCHER_NAME.test(`${name} ${idTail}`)) return 'launcher';
  // 托里德（BioWeapon）、沙皇、赤毒·布拉玛：名字不带信号，但以爆炸弹药为主。
  // 判据：名字里的 Zarr / Bramma，或资源末段的已知 id（不看携带方式，赤毒·布拉玛是 Bow 但归发射器）。
  if (EXPLOSIVE_NAME.test(name) || EXPLOSIVE_ID.test(idTail)) return 'launcher';
  return null;
}

/**
 * 是不是**真正的弓**（能吃弓箭类 Mod、装弓箭·赋能）。
 *
 * 依据只有 `holsterCategory === 'BOW'`。为什么不信 `CROSSBOW` 标签：实测弩（诸葛连弩 / 阿提卡）
 * 的标签里有 `CROSSBOW`，而真正的弓（如恐惧）标签里是 `BOW`。需求方 2026-07-11 确认：
 * **弩不能装弓箭类 Mod，也不能装弓箭·赋能**，所以两者必须分开。
 */
export function isTrueBow(w: ExportWeapon): boolean {
  return w.holsterCategory === 'BOW';
}

/**
 * 是不是**双持手枪**（双手枪类，能吃「双枪·」赋能）。
 *
 * 依据官方导出的 `compatibilityTags`：双手枪带 `DUAL_PISTOL`（双子葛拉卡达这类带霰弹模式的也算）。
 * 需求方 2026-07-11：副手即使是霰弹模式也只算副手，所以副手侧只区分"双持 / 非双持"。
 */
export function isDualPistolWeapon(w: ExportWeapon): boolean {
  return (w.compatibilityTags ?? []).some((t) => /DUAL/i.test(t));
}

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
 * 用途：近战只判出宽类 `melee` 时，用官方导出的架势标签补出细类。
 * D-001 恢复近战区分后重新启用。
 *
 * D-141：**人工层构造的武器版本**（如暗黑分合剑拆成巨刃 / 双剑）也走它，
 * 由 `slotsFromStanceTags()` 直接判定。
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

/**
 * 由**架势标签**直接判定近战槽位（D-141）。
 *
 * 用于人工层构造的武器版本（例如暗黑分合剑拆成 `@heavy_blade` / `@dual_swords`）：
 * 这些版本没有独立的导出条目，靠构造时给的架势标签定细类。
 * 给定一个细类就只保留那个细类——拆版本的用意就是**每版只装对应架势的 Mod**。
 */
export function slotsFromStanceTags(tags: string[]): SlotResolution {
  const specific: ModSlotKind[] = [];
  for (const t of tags) {
    const k = STANCE_TAG_TO_KIND[t.toUpperCase()];
    if (k && !specific.includes(k)) specific.push(k);
  }
  return {
    broad: 'melee',
    specific,
    source: specific.length > 0 ? 'stance-tags' : 'unresolved',
    basis: { tags },
    unresolved: specific.length === 0,
  };
}

/** 武器类条目（只声明用到的字段） */
export interface ZkWeaponClass {
  /** 武器 id */
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

  // 哨兵 / 猎犬武器属于伙伴武器，不在本项目的配装范围
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
      // 只判出宽类时，用官方 `*_STANCE` 标签补细类
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
 * 只用官方导出判定武器槽位（不依赖任何仓库外文件）。
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

  // 守护 / 猎犬武器：**与角色武器共用同一套 Mod**（需求方 2026-11-08 确认：
  // 「守护武器用的跟角色武器是一样的 mod，只是他们有的分类是步枪有的是近战」）。
  // 所以这里和普通武器走同一条 holsterCategory 判定，不再标 unresolved。
  if (product === 'SentinelWeapons') {
    // 猎犬近战三把（巴托腾 / 莱斯腾 / 阿卡腾）导出只给 `HOUND_WEAPON`、不带 holster，
    // 按需求方确认的「近战」归类。
    if (tags.includes('HOUND_WEAPON')) {
      return { broad: 'melee', specific: [], source: 'manual', basis, unresolved: false };
    }
    // 近战类 holster（分离 / 分离 Prime = MELEE）不在 HOLSTER_KINDS 里，要先拦
    if (MELEE_HOLSTERS.has(holster ?? '')) {
      return { broad: 'melee', specific: [], source: 'holster', basis, unresolved: false };
    }
    if (holster !== undefined && HOLSTER_KINDS[holster] !== undefined) {
      return { broad: HOLSTER_KINDS[holster], specific: [], source: 'holster', basis, unresolved: false };
    }
    // 无 holster 的（激光点发 / 棱晶·激光点发 / 激光点发 Prime）：
    // 需求方 2026-11-08 确认「Pistol 说明就是手枪啊」→ 手枪类。
    // ⚠ 不能只靠 `uniqueName`：build-mods 传进来的对象不一定带它。
    const idTailLower = (w.uniqueName ?? '').split('/').pop() ?? '';
    if (/pistol/i.test(idTailLower) || /pistol/i.test(w.name ?? '')) {
      return { broad: 'pistol', specific: [], source: 'manual', basis, unresolved: false };
    }
    return { broad: 'rifle', specific: [], source: 'unresolved', basis, unresolved: true };
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

  // 伽拉之爪（Garuda Talons / Garuda Prime Talons，`GarudaClaws` / `GarudaPrimeClaws`）：
  // 需求方 2026-11-08 确认「是 Garuda 被动带的近战武器，算近战，他不受强度加成」。
  // 它归在 `SpecialItems` + `CLAWS_STANCE_STANCE`，既不是 POWER_WEAPON 也没有 holster 的枪械分支，
  // 必须单独认，否则会掉进下面的兜底。
  if (tags.some((t) => t.toUpperCase() === 'CLAWS_STANCE_STANCE')) {
    return { broad: 'melee', specific: ['claws'], source: 'stance-tags', basis, unresolved: false };
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
 *
 * @param slots 槽位判定结果
 * @param trueBow 是否**真正的弓**（`isTrueBow`）。默认 false：
 *        弩（诸葛连弩 / 阿提卡）在数据里与弓同处于 `BOW` 携带方式，但**弩不能装弓箭类 Mod**
 *        （需求方 2026-07-11 确认），所以只有确认为弓时才把 `bow` 放进可装集合。
 */
export function compatibleModKinds(slots: SlotResolution, trueBow = false): ModSlotKind[] {
  if (slots.broad === 'bow' && !trueBow) {
    // 弩：按步枪算（步枪类 + 主武器类），**不含**弓箭类
    return ['rifle', 'primary'];
  }
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
export function canEquipMod(slots: SlotResolution, modSlotKind: string, trueBow = false): boolean {
  const kinds = compatibleModKinds(slots, trueBow);
  return kinds.includes(modSlotKind as ModSlotKind);
}
