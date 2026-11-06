/**
 * 武器切换面板（D-093）。
 *
 * 需求方 2026-11-06：
 * > 「开放武器切换功能，目前暂定可以切换所有主武器。可以使用名称搜索，或者下拉栏选择，
 * > 为下拉栏加入主要次要近战空战的筛选，类别内再按类型分类。」
 *
 * 结构：
 * ```
 * 大类（主要 / 次要 / 近战 / 空战）   ← 前三个按需求只开放"主要"，其余置灰
 *   └ 类型（步枪 / 霰弹枪 / 狙击枪 / 弓 / 手枪 / 剑 …）  ← 取自 weapon-slots.json 的 broad/specific
 *        └ 武器
 * ```
 *
 * 数据来源：`weapons/{primary,secondary,melee,archgun,archmelee}.json` +
 *           `mods/weapon-slots.json` 的 `slots.broad` / `slots.specific`。
 */

/** 大类定义：id / 中文名 / 对应的 generated 文件 / 是否可选 */
export const WEAPON_GROUPS = [
  { id: 'primary', label: '主要', files: ['primary'], enabled: true },
  { id: 'secondary', label: '次要', files: ['secondary'], enabled: false },
  { id: 'melee', label: '近战', files: ['melee'], enabled: false },
  { id: 'archwing', label: '空战', files: ['archgun', 'archmelee'], enabled: false },
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
  const zkClass = (slotEntry && slotEntry.slots && slotEntry.slots.basis && slotEntry.slots.basis.zkClass) || null;

  // 分类优先级（D-098）：
  //   1. 近战 → 用 `specific`（剑/锤/匕首…，官方本来就细分）
  //   2. 其余 → 用官方 `zkClass`：它能识别出 broad 之外的真实子类，
  //      例如 rifle 里的 launcher（发射器）/ crossbow（弩）、
  //      pistol 里的 dual_pistols（双手枪）/ shotgun_sidearm（手炮）
  //   3. 都拿不到 → 退回 broad 本身
  let typeKey;
  if (broad === 'melee' || broad === 'archmelee') {
    // specific 缺失时**不要**退回 broad：broad 对近战就是 'melee'，
    // 但空 specific 的武器会被误显示成"手枪/步枪"这种其它大类的名字。
    typeKey = specific.length ? specific[0] : '__other_melee__';
  } else if (zkClass && zkClass !== broad && TYPE_LABEL[zkClass]) {
    // D-099 C：弩并入弓弩（同一个类型桶）
    typeKey = zkClass === 'crossbow' ? 'bow' : zkClass;
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

/** 按名称搜索（中英文都匹配，大小写/空格不敏感） */
/**
 * 弹道（发射方式）分类（D-099 A）。
 *
 * **第二层筛选器**，不进入"类型"树——类型仍是官方 zkClass 的划分。
 * 依据 `modes[].trigger`：
 *
 * ```
 * 子弹（semi/auto/burst） / 蓄力（charge） / 光束（held） / 其它（active/unknown）
 * ```
 *
 * 一把武器有多种模式时，只要**任一模式**匹配就算（例如 auto+semi 既属全自动也属半自动）。
 */
export const FIRE_STYLE_OPTIONS = [
  { id: 'all', label: '全部弹道' },
  { id: 'auto', label: '全自动' },
  { id: 'semi', label: '半自动' },
  { id: 'burst', label: '点射' },
  { id: 'charge', label: '蓄力' },
  { id: 'held', label: '持续/光束' },
];

/** 该武器是否属于指定弹道（任一模式匹配即可） */
export function weaponMatchesStyle(weapon, styleId) {
  if (!styleId || styleId === 'all') return true;
  const modes = weapon.modes || [];
  if (!modes.length) return false;
  return modes.some((m) => {
    if (styleId === 'held') return m.trigger === 'held' || m.trigger === 'active';
    return m.trigger === styleId;
  });
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
 * 武器名后面的「数据有问题」标记（D-101）。
 *
 * 需求方 2026-11-06：
 * > 「数据不对的先加上标记，在选择武器的时候多个错误标记，
 * > 这样我选择的时候就知道他不对去编辑面板。」
 *
 * 只加一个符号，不写解释文字（遵守「界面只放数值本身」的约定，
 * 详细原因放在 title 里，鼠标悬停能看到）。
 */
export const ISSUE_MARK = '\u26a0';

/** 把武器名和问题标记拼成下拉项文字 */
export function weaponLabel(weapon, issues) {
  const name = weapon.nameZh || weapon.name;
  if (!issues || issues.length === 0) return name;
  return name + ' ' + ISSUE_MARK;
}
