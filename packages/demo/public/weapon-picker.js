/**
 * 武器切换面板（D-093）。
 *
 * 需求方 2026-11-06：
 * > 「开放武器切换功能，目前暂定可以切换所有主武器。可以使用名称搜索，或者下拉栏选择，
 * > > 为下拉栏加入主要次要近战空战的筛选，类别内再按类型分类。」
 *
 * 2026-11-06 后续（D-119）：四个大类**全部开放**（主要 / 次要 / 近战 / 空战）。
 *
 * 结构：
 * ```
 * 大类（主要 / 次要 / 近战 / 空战）
 *   └ 类型（步枪 / 霰弹枪 / 狙击枪 / 弓 / 手枪 / 剑 …）  ← 取自 weapon-slots.json 的 broad/specific
 *        └ 武器
 * ```
 *
 * 数据来源：`weapons/{primary,secondary,melee,archgun,archmelee}.json` +
 *           `mods/weapon-slots.json` 的 `slots.broad` / `slots.specific`。
 */

/** 大类定义：id / 中文名 / 对应的 generated 文件 / 是否可选（D-119：四个大类全部开放） */
export const WEAPON_GROUPS = [
  { id: 'primary', label: '主要', files: ['primary'], enabled: true },
  { id: 'secondary', label: '次要', files: ['secondary'], enabled: true },
  { id: 'melee', label: '近战', files: ['melee'], enabled: true },
  { id: 'archwing', label: '空战', files: ['archgun', 'archmelee'], enabled: true },
];

/** `broad` + `specific` → 中文类型名 */
const TYPE_LABEL = {
  rifle: '步枪',
  launcher: '发射器',
  crossbow: '弓弩',
  shotgun: '霰弹枪',
  sniper: '狙击枪',
  bow: '弓弩',
  pistol: '手枪',
  dual_pistols: '双手枪',
  shotgun_sidearm: '手炮',
  dual_shotguns: '双手炮',
  melee: '近战',
  archgun: '空战枪械',
  archmelee: '空战近战',
};

/** 近战细分（`specific`）→ 中文 */
const MELEE_TYPE_LABEL = {
  sword: '剑', hammer: '锤', fist: '拳套', tonfa: '拐刃', heavy_scythe: '巨镰',
  dagger: '匕首', whip: '鞭', warfan: '战扇', sword_and_shield: '剑盾',
  nikana: '武士刀', rapier: '刺剑', two_handed_nikana: '双手武士刀',
  blade_and_whip: '鞭刃', heavy_blade: '巨刃', dual_daggers: '双匕首',
  dual_swords: '双剑', machete: '砍刀', staff: '棍', scythe: '镰刀',
  claws: '爪', nunchaku: '双节棍', polearm: '长柄武器', glaive: '飞刃',
  gunblade: '枪刃', hammer_shield: '锤盾', warframe: '战甲', unknown: '其它',
  __other_melee__: '其它近战',
  __other__: '其它',
  sparring: '拳刃', dual_nikanas: '双武士刀', assault_saw: '战锯',
};

/**
 * 取一件武器的分类路径。
 * @param slotEntry `weapon-slots.json` 里该武器的记录
 * @returns `{ group, type }`，group 是 broad（rifle/shotgun/…），type 是细分（仅近战有意义）
 */
export function classifyWeapon(slotEntry) {
  const broad = (slotEntry && slotEntry.slots && slotEntry.slots.broad) || 'unknown';
  const specific = (slotEntry && slotEntry.slots && slotEntry.slots.specific) || [];
  const subclass = (slotEntry && slotEntry.subclass) || null;

  // 分类优先级（D-098）：
  //   1. 近战 → 用 `specific`（剑/锤/匕首…，官方本来就细分）
  //   2. 其余 → 用数据层给的 `subclass`：它标出 broad 之外的真实子类，
  //      例如 rifle 里的 launcher（发射器）/ crossbow（弩）
  //      （这两个都吃步枪类 Mod，broad 仍是 rifle，只在界面上分开展示）
  //   3. 都拿不到 → 退回 broad 本身
  let typeKey;
  if (broad === 'melee' || broad === 'archmelee') {
    // specific 缺失时**不要**退回 broad：broad 对近战就是 'melee'，
    // 但空 specific 的武器会被误显示成"手枪/步枪"这种其它大类的名字。
    typeKey = specific.length ? specific[0] : '__other_melee__';
  } else if (subclass && subclass !== broad && TYPE_LABEL[subclass]) {
    // D-099 C：弩并入弓弩（同一个类型桶）
    typeKey = subclass === 'crossbow' ? 'bow' : subclass;
  } else {
    typeKey = broad;
  }

  return {
    broad,
    typeKey,
    groupLabel: TYPE_LABEL[broad] || broad,
    typeLabel: MELEE_TYPE_LABEL[typeKey] || TYPE_LABEL[typeKey] || typeKey,
  };
}

/**
 * 把武器列表组织成 `大类 → 类型 → 武器[]` 的两层结构，供下拉栏渲染。
 *
 * @param weapons 所有武器（带 category）
 * @param slotFile `weapon-slots.json`
 * @returns `Map<大类id, { label, enabled, types: Map<类型key, { label, weapons }> }>`
 */
export function groupWeapons(weapons, slotFile) {
  const out = new Map();
  for (const g of WEAPON_GROUPS) out.set(g.id, { ...g, types: new Map() });

  for (const w of weapons) {
    const groupId = groupOfCategory(w.category);
    const group = out.get(groupId);
    if (!group) continue;
    const entry = slotFile.weapons[w.id];
    const cls = classifyWeapon(entry);
    // ⚠ 战甲技能武器（显赫刀剑、和平缔造者、Dex 妖精…）在 weapon-slots.json 里
    //   记的是武器类 broad（pistol/rifle），但**武器所在的 generated 文件**才是
    //   本项目认定的类别。这里若 broad 与文件类别冲突，按"其它近战/其它"处理，
    //   避免近战列表里冒出"手枪""步枪"这类错误标签。
    const slotBroadGroup = broadToGroup(cls.broad);
    if (slotBroadGroup !== groupId) {
      cls.typeKey = groupId === 'melee' || groupId === 'archwing' ? '__other_melee__' : '__other__';
      cls.typeLabel = TYPE_LABEL[cls.typeKey] || group.label;
    }
    let bucket = group.types.get(cls.typeKey);
    if (!bucket) {
      bucket = { label: cls.typeLabel, weapons: [] };
      group.types.set(cls.typeKey, bucket);
    }
    bucket.weapons.push(w);
  }

  // 每个类型内按名字排序
  for (const g of out.values()) {
    for (const bucket of g.types.values()) {
      bucket.weapons.sort((a, b) => String(a.nameZh || a.name).localeCompare(String(b.nameZh || b.name), 'zh-CN'));
    }
  }
  return out;
}

/**
 * weapon-slots 的 `broad` → 大类 id（与 generated 的 category 对齐）。
 * rifle/shotgun/bow/sniper 都属主武器，pistol 属副武器。
 */
function broadToGroup(broad) {
  switch (broad) {
    case 'rifle':
    case 'shotgun':
    case 'bow':
    case 'sniper':
      return 'primary';
    case 'pistol':
      return 'secondary';
    case 'melee':
      return 'melee';
    case 'archgun':
    case 'archmelee':
      return 'archwing';
    default:
      return 'other';
  }
}

/** generated 的 category → 大类 id */
function groupOfCategory(category) {
  switch (category) {
    case 'primary': return 'primary';
    case 'secondary': return 'secondary';
    case 'melee': return 'melee';
    case 'archgun':
    case 'archmelee': return 'archwing';
    default: return 'other';
  }
}

/**
 * 武器大类 id（D-093 / D-119 / D-134）。
 * `archgun` / `archmelee` 都归到 `archwing`；认不出时退回 `primary`。
 * app.js 换枪后用它把「大类」下拉停在当前武器所在的类别。
 */
export function weaponGroupId(weapon) {
  const cat = weapon && weapon.category;
  if (cat === 'archgun' || cat === 'archmelee') return 'archwing';
  return cat || 'primary';
}

/** 按名称搜索（中英文都匹配，大小写/空格不敏感） */
/**
 * 弹道（发射方式）分类（D-099 A）。
 *
 * **第二层筛选器**，不进入"类型"树——类型仍是 broad + 细类的划分。
 * 依据**主模式**的 `modes[0].trigger`：
 *
 * ```
 * 子弹（semi/auto/burst） / 蓄力（charge） / 光束（held） / 引爆（active，归发射器）
 * ```
 *
 * 需求方 2026-11-12 改了两处：只算主模式（不再"任一模式匹配就算"）、
 * `active` 不算射线（潘塔 / 奇点枪这类归到「主武器 → 发射器」）。
 */
export const FIRE_STYLE_OPTIONS = [
  { id: 'all', label: '全部弹道' },
  { id: 'auto', label: '全自动' },
  { id: 'semi', label: '半自动' },
  { id: 'burst', label: '点射' },
  { id: 'charge', label: '蓄力' },
  { id: 'held', label: '持续/光束' },
];

/**
 * 该武器是否属于指定弹道。
 *
 * 需求方 2026-11-12：
 * > 「潘塔从哪儿看都没射线标签啊」→ 潘塔/奇点枪的扳机是 `active`（引爆式），
 *   旧代码把 `active` 和 `held` 一起算作"持续/光束"，它们才出现在射线组里。
 * > 「active 不需要单独一类，他们就放到发射器里面去。」
 *   → `active` 不再算射线；这些武器本身带发射器细类，归到「主武器 → 发射器」。
 * > 「模式参考只算主模式。」
 *   → 只看**第一个模式**（主模式）的扳机：绘墨（主 held + 次 semi）只算射线，
 *     巴什穆（主 auto + 次 held）只算全自动，不再按"任一模式"重复入组。
 */
export function weaponMatchesStyle(weapon, styleId) {
  if (!styleId || styleId === 'all') return true;
  const main = (weapon.modes || [])[0];
  if (!main) return false;
  return main.trigger === styleId;
}

/** 按弹道筛选武器列表 */
export function filterByStyle(weapons, styleId) {
  if (!styleId || styleId === 'all') return weapons;
  return weapons.filter((w) => weaponMatchesStyle(w, styleId));
}

export function searchWeapons(weapons, keyword) {
  const q = String(keyword || '').trim().toLowerCase().replace(/\s+/g, '');
  if (!q) return [];
  return weapons.filter((w) => {
    const zh = String(w.nameZh || '').toLowerCase().replace(/\s+/g, '');
    const en = String(w.name || '').toLowerCase().replace(/\s+/g, '');
    return zh.includes(q) || en.includes(q);
  });
}

/**
/**
 * 把武器名渲染成下拉项文字。
 *
 * ⚠ 需求方 2026-11-12：「现在应该不需要错误标记了，所有面板转到 wfcd 已经修正了，清除掉。」
 * 原来的 ⚠ 数据错误标记（D-101）已整个移除，这里只返回中文名。
 * 保留成函数是因为调用点较多，且以后若要加别的标记（如「新武器」）只需改这一处。
 */
export function weaponLabel(weapon) {
  return weapon.nameZh || weapon.name;
}
