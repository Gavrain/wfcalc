/**
 * 数据层（D-105）：把 `packages/data/src/generated/` 的原始 JSON 变成界面能直接用的
 * "武器 / 可装 Mod / 赋能"，并判断某张 Mod 是不是纯功能类（劣化槽用）。
 *
 * 这一层**不碰 DOM、不算伤害**。原来这些函数都在 `app.js` 里，
 * 与"怎么画"混在一起，改界面时很容易顺手改到取数逻辑。
 *
 * ⚠ 浏览器与 Node 校对脚本共用本文件（纯 JS，无 Node API）。
 */
import { isKuvaFamily } from '../../core/src/index.ts';
import { isSemiCannonade, isSemiAutoOnlyWeapon, isModCompatibleWithWeapon, modKindsFor } from '../../data/src/adapter.ts';
import { SLOT_COUNT, store } from './app-store.js';

/** 各类别武器文件 + 槽位 / Mod / 赋能文件（相对 demo 站点根目录） */
const GENERATED = '/packages/data/src/generated';
const WEAPON_FILES = ['primary', 'secondary', 'melee', 'archgun', 'archmelee'];

const getJSON = (url) => fetch(url).then((r) => r.json());

/** 武器名称（中文优先） */
export function modName(mod) {
  return mod.name.zh || mod.name.en;
}

/**
 * 抓取全部武器数据，返回 `{ weapons, weaponById, slotFile, modFile, arcaneFile, groups }`。
 * @param groupWeapons 分组函数（来自 weapon-picker.js，注入以避免这里再依赖它）
 */
export async function loadAllWeapons(groupWeapons) {
  const [slotFile, modFile, arcaneFile, ...weaponFiles] = await Promise.all([
    getJSON(GENERATED + '/mods/weapon-slots.json'),
    getJSON(GENERATED + '/mods/mods.json'),
    getJSON(GENERATED + '/mods/arcanes.json'),
    ...WEAPON_FILES.map((k) => getJSON(GENERATED + '/weapons/' + k + '.json')),
  ]);

  const weapons = [];
  for (const f of weaponFiles) for (const w of f.weapons) weapons.push(w);

  const weaponById = new Map();
  for (const w of weapons) weaponById.set(w.id, w);

  return { weapons, weaponById, slotFile, modFile, arcaneFile, groups: groupWeapons(weapons, slotFile) };
}

/**
 * 为某一把武器建立"当前可用数据"（由调用方写进 store.data）。
 *
 * ```
 * data = {
 *   baseWeapon       generated 原样（合并 override 时每次都从它出发，避免叠加）
 *   weapon           合并 override 之后的武器
 *   isKuva           是否玄骸系（D-042）
 *   availableMods    这把武器能装的 Mod（按槽位 + 专属过滤 + 中文名排序）
 *   modById          id → Mod
 *   arcaneByKey      key → 赋能
 *   primaryArcanes   这把武器能用的赋能列表
 *   slotKinds        Mod 槽位种类
 *   overrides        manual/weapon-overrides.json 的内容（开发态才有）
 * }
 * ```
 *
 * @param weaponId        武器 id
 * @param options.modeId  默认选中的模式 id（找不到就用第一个）
 */
export function buildWeaponData(weaponId, options = {}) {
  const all = store.dataAll;
  if (!all) throw new Error('data 还没准备好：先调用 loadAllWeapons()');
  const weapon = all.weaponById.get(weaponId);
  if (!weapon) throw new Error('找不到武器 ' + weaponId);

  const entry = all.slotFile.weapons[weaponId] || { slots: {}, modKinds: [] };
  const kinds = modKindsFor(entry, entry.slots);
  const availableMods = all.modFile.mods
    .filter(function (m) { return kinds.indexOf(m.slotKind) >= 0; })
    .filter(function (m) { return isModCompatibleWithWeapon(m, weapon); })
    .sort(function (a, b) { return String(modName(a)).localeCompare(String(modName(b)), 'zh-CN'); });

  const byId = new Map();
  availableMods.forEach(function (m) { byId.set(m.id, m); });
  const arcaneByKey = new Map();
  const primaryArcanes = [];

  // D-119：赋能按**武器大类**过滤，不再按 Mod 槽种类（slotKind）。
  // D-138：大类细化为「主要 / 弓箭· / 霰弹· / 次要 / 双枪·」——
  //   弓额外拿 弓箭·、主手霰弹枪额外拿 霰弹·，副手霰弹只走次要。
  all.arcaneFile.arcanes.forEach(function (a) {
    arcaneByKey.set(a.key, a);
    if (isArcaneUsableOn(a, weapon, entry)) primaryArcanes.push(a);
  });

  // 模式与变体索引按"默认模式"复位
  const defaultModeId = options.modeId || 'primary';
  const primaryIdx = weapon.modes.findIndex(function (m) { return m.id === defaultModeId; });
  store.ui.modeIndex = primaryIdx >= 0 ? primaryIdx : 0;
  store.ui.variantIndex = 0;

  return {
    baseWeapon: weapon,
    weapon: weapon,
    /** `weapon-slots.json` 里本武器的记录（D-138：赋能可用性要看 `zkClass` 细类） */
    slotEntry: entry,
    isKuva: isKuvaFamily(weapon.id, weapon.variantType, weapon.name),
    availableMods: availableMods,
    modById: byId,
    arcaneByKey: arcaneByKey,
    primaryArcanes: primaryArcanes,
    slotKinds: kinds,
    overrides: {},
  };
}

/** 换枪时清空配装（D-052：默认不预装 Mod） */
export function clearLoadout() {
  for (let i = 0; i < SLOT_COUNT; i++) store.modSlots[i] = null;
  store.exilusModId = null;
  store.arcaneKey = null;
}

/**
 * 武器**可装**的赋能大类（D-138，需求方 2026-11-06 确认）。
 *
 * | 武器 | 可装大类 |
 * |---|---|
 * | 主要（步枪 / 狙击 / 发射器…） | primary（主要· + 分形·） |
 * | 弓（zkClass = bow） | bow（弓箭·）+ primary |
 * | 主手霰弹枪（zkClass = shotgun） | shotgun（霰弹·）+ primary |
 * | 副手霰弹 / 双持霰弹 / 手枪 | secondary（次要· + 瀑流· + 联结·） |
 * | 双持（dual_pistols / dual_shotguns） | 额外加 dual（双枪·） |
 * | 近战 / Zaw | melee（近战· + 神威·） |
 * | 组合枪（Kitgun） | kitgun（和平· + 残差·） |
 * | 空战武器 | 无（数据缺口） |
 *
 * 需求方原话：「主手霰弹能装主手赋能和霰弹专属赋能，副手霰弹只算副手，
 * 跟霰弹赋能无关」「（弓）弓箭· + 主要· + 分形·」。
 *
 * @param weapon `generated/weapons/*.json` 里的武器记录
 * @param slotEntry `weapon-slots.json` 里该武器的记录（取 `zkClass` 细类）
 * @returns 可装大类 id 数组（对应 `arcanes.json` 的 `category`；`dual` 为虚拟大类）
 */
export function arcaneCategoriesFor(weapon, slotEntry) {
  const zk = slotEntry && slotEntry.slots && slotEntry.slots.basis && slotEntry.slots.basis.zkClass;
  const cat = weapon && weapon.category;
  if (cat === 'primary') {
    if (zk === 'bow') return ['bow', 'primary'];
    if (zk === 'shotgun') return ['shotgun', 'primary'];
    return ['primary'];
  }
  if (cat === 'secondary') {
    return zk === 'dual_pistols' || zk === 'dual_shotguns'
      ? ['secondary', 'dual']
      : ['secondary'];
  }
  if (cat === 'melee') return ['melee']; // Zaw 刀头与近战共用 近战·/神威· 两前缀，都按 melee
  return [];
}

/**
 * 一条赋能能不能装在这个武器上（`arcanes.json` 的 `category` 只有大类，
 * 「双枪·」靠名称前缀区分：它是 `secondary` 里唯一属于**双持**的那条）。
 */
export function isArcaneUsableOn(arcane, weapon, slotEntry) {
  const cats = arcaneCategoriesFor(weapon, slotEntry);
  const prefix = String((arcane.name && arcane.name.zh) || '');
  if (prefix.startsWith('双枪·')) return cats.includes('dual');
  return cats.includes(arcane.category);
}

/**
 * 劣势槽只接受"不影响伤害"的功能类 Mod。
 *
 * ⚠ 数据里 `reloadSpeed`（装填速度）与 `magazine`（弹匣容量）被标成 `functional/utility`，
 *   但两者都**直接影响「持续伤害」口径**：
 *   ```
 *   持续伤害 = 单次射击 × 弹匣 ÷ (弹匣 ÷ 射速 + 装填时间)
 *   装填时间 = 面板装填 ÷ (1 + Σ装填速度%)
 *   ```
 *   所以它们属于**影响伤害**的词条，不能当纯功能卡塞进劣化槽（D-037）。
 *   同理 `fireRate` / `multishot` / `statusChance` 等一律按"影响伤害"处理。
 */
export const DAMAGE_AFFECTING_STATS = new Set([
  'baseDamage', 'multishot', 'fireRate', 'statusChance', 'statusDamage', 'statusDuration',
  'critChance', 'critMultiplier', 'weakpointCritChance', 'weakpointDamage',
  'reloadSpeed', 'magazine', 'slashOnCrit', 'impactToSlash',
]);

export function isExilusMod(mod) {
  const stats = mod.stats;
  if (!stats.length) return false;
  for (let i = 0; i < stats.length; i++) {
    const s = stats[i];
    // ① 有进伤害乘区的词条
    if (s.bucket && s.bucket !== 'utility') return false;
    // ② 虽然是 utility，但影响伤害（装填 / 弹匣等，D-037）
    if (DAMAGE_AFFECTING_STATS.has(s.stat)) return false;
    if (s.stat.indexOf('elemental:') === 0 || s.stat.indexOf('physical:') === 0) return false;
    if (s.key === 'co') return false;
  }
  return true;
}

/**
 * 这件 Mod 能不能装到当前武器上（D-091）。
 *
 * 半自动炮轰系列（Semi-*-Cannonade）要求「只有一个射击模式，且该模式为半自动」，
 * 并且**只看武器本身的射击模式**——灵化模式是后加上去的，不参与判定。
 */
export function isModAllowedOnWeapon(mod) {
  if (!store.data || !store.data.weapon) return true;
  if (isSemiCannonade(mod)) return isSemiAutoOnlyWeapon(store.data.weapon.modes);
  return true;
}
