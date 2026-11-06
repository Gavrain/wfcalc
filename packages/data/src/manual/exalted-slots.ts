/**
 * 人工维护的武器 → Mod 槽位补充。
 *
 * 用途：**显赫武器**（战甲技能武器）的武器类判定。
 *
 * 为什么需要人工：官方导出对显赫武器只给 `SpecialItems` + `POWER_WEAPON` 标签，
 * 不给"它长得像哪类武器"，而游戏里它们装的是对应形态的 Mod。
 *
 * 口径（需求方确认 2026-11-05）：
 *   · **近战类的显赫武器一律归为 melee**，不区分剑 / 爪 / 法杖细类；
 *   · **枪械类的显赫武器归到对应的枪**（手枪 / 步枪）。
 *
 * 因此这张表只需要给出"近战还是枪、枪的话是哪一类"，不需要写细类。
 * 没登记会被流水线列入"待人工确认"。
 */

/**
 * 该武器归到哪一类 Mod 槽位。
 * 这里**故意不依赖 data-build 的类型**——人工维护层只放数据，
 * 类型由消费方（build-mods）自行声明与校验，避免 data 包反向依赖构建包。
 */
export type ExaltedBroadKind =
  | 'melee'
  | 'pistol'
  | 'rifle'
  | 'shotgun'
  | 'bow'
  | 'sniper'
  | 'archgun'
  | 'tome'
  | 'primary';

export interface ExaltedSlotOverride {
  /** 该武器归类到哪一类（近战 = melee；枪械 = pistol / rifle …） */
  broad: ExaltedBroadKind;
  /** 说明 */
  note: string;
}

/** key = 官方导出里的英文显示名 */
export const EXALTED_SLOT_OVERRIDES: Readonly<Record<string, ExaltedSlotOverride>> = {
  // ---- 近战显赫武器：一律 melee ----
  'Exalted Blade': { broad: 'melee', note: '圣剑 4 技能之剑' },
  'Exalted Umbra Blade': { broad: 'melee', note: '暗影圣剑 4 技能之剑' },
  'Exalted Prime Blade': { broad: 'melee', note: '圣剑 Prime 关联技能之剑' },
  'Desert Wind': { broad: 'melee', note: '迦楼罗 1 技能之爪' },
  'Desert Wind Prime': { broad: 'melee', note: '迦楼罗 Prime 1 技能之爪' },
  'Valkyr Talons': { broad: 'melee', note: '女武神 4 技能之爪' },
  'Valkyr Prime Talons': { broad: 'melee', note: '女武神 Prime 4 技能之爪' },
  'Iron Staff': { broad: 'melee', note: '猴王 4 技能铁棒' },
  'Iron Staff Prime': { broad: 'melee', note: '猴王 Prime 4 技能铁棒' },
  Whipclaw: { broad: 'melee', note: '毒妈 2 技能鞭击' },
  'Whipclaw Prime': { broad: 'melee', note: '毒妈 Prime 2 技能鞭击' },
  'Shattered Lash': { broad: 'melee', note: '玻璃人 1 技能碎刃' },
  'Shattered Lash Prime': { broad: 'melee', note: '玻璃人 Prime 1 技能碎刃' },
  Diwata: { broad: 'melee', note: '迪瓦塔（近战显赫）' },
  'Diwata Prime': { broad: 'melee', note: '迪瓦塔 Prime（近战显赫）' },
  'Shadow Claws': { broad: 'melee', note: '暗影之爪' },
  'Shadow Claws Prime': { broad: 'melee', note: '暗影之爪 Prime' },
  'Shadow Clones': { broad: 'melee', note: '暗影分身' },
  'Shadow Clones Prime': { broad: 'melee', note: '暗影分身 Prime' },
  'Landslide Fists': { broad: 'melee', note: '地裂拳' },
  'Landslide Fists Prime': { broad: 'melee', note: '地裂拳 Prime' },
  Ironbride: { broad: 'melee', note: '钢铁新娘（近战显赫）' },

  // ---- 枪械显赫武器：归到对应的枪 ----
  'Dex Pixia': { broad: 'pistol', note: '小仙女之枪：手枪类' },
  'Dex Pixia Prime': { broad: 'pistol', note: '小仙女之枪 Prime：手枪类' },
  Regulators: { broad: 'pistol', note: '监管者：手枪类' },
  'Regulators Prime': { broad: 'pistol', note: '监管者 Prime：手枪类' },
  'Balefire Charger': { broad: 'pistol', note: '焚罪者：手枪类' },
  'Balefire Charger Prime': { broad: 'pistol', note: '焚罪者 Prime：手枪类' },
  Glory: { broad: 'pistol', note: '荣耀：手枪类' },
  Arquebex: { broad: 'archgun', note: '远程炮台：空战枪械' },

  // ---- 守护近战武器：导出带 SENTINEL_WEAPON 标签，槽位判定会给 unresolved ----
  // D-141：需求方要求「分离 / 分离 Prime 能选能算」→ 归**近战**（吃近战类 Mod）。
  Deconstructor: { broad: 'melee', note: '分离：赫利俄斯守护武器（近战），D-141' },
  'Deconstructor Prime': { broad: 'melee', note: '分离 Prime：赫利俄斯守护武器（近战），D-141' },
};

/**
 * 若该武器在补充表里，返回它的归类；否则 null。
 * @param enName 官方导出里的英文显示名
 */
export function lookupExaltedSlots(enName: string): ExaltedSlotOverride | null {
  return Object.hasOwn(EXALTED_SLOT_OVERRIDES, enName) ? EXALTED_SLOT_OVERRIDES[enName] ?? null : null;
}