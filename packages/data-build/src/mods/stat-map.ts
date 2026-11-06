/**
 * ZKMODS 属性键 → 本项目的「属性 / 乘区」映射。
 *
 * 背景：ZKMODS 的属性键（`dmg` / `ms` / `cc` / `heat` …）是紫卡模拟器的内部命名，
 * 而 `docs/乘区归属表.md` 定义的是本项目的乘区口径。两边必须显式对一次，
 * 不能靠名字猜——名字相近但口径不同的最容易被错配，例如：
 *   · `sd`   = 异常状态伤害 +X%（不是状态持续时间）
 *   · `co`   = 镀层/条件过载类「每个异常状态 +X% 伤害」
 *   · `weak` = 对弱点伤害（走第 3.2 节爆头倍率，不是派系加成的兄弟）
 *   · `ps`   = 弹速 / 光束射程（不是触发几率）
 *
 * 约定：
 *   1. 每个键都落到 `kind` 上，`kind` 决定计算内核怎么用它：
 *        normal     —— 稳定的面板加量，直接进乘区（基伤/多重/暴率/元素…）
 *        functional —— 功能类，影响手感不进伤害汇总（换弹、弹匣、变焦…）
 *        conditional—— 有触发条件或叠层，数值不是常驻（镀层类、弱点击杀、猎人的战备…）
 *        special    —— 武器专属机制（集团特效、灵化词条、Tennokai、特殊武器被动…）
 *        skip       —— 明确不参与伤害计算
 *   2. 未登记的键**不静默丢弃**：流水线会列成"待确认清单"交人工判定。
 */
import type { DamageType } from '../../../core/src/damage-types.ts';
import type { BucketId } from '../../../core/src/buckets.ts';

/** 本项目可被 Mod 影响的属性（乘区归属表口径） */
export type ModStatId =
  | 'baseDamage'
  | 'multishot'
  | 'critChance'
  | 'critMultiplier'
  | 'statusChance'
  | 'fireRate'
  | 'reloadSpeed'
  | 'magazine'
  | 'faction'
  | 'weakpointDamage'
  | 'weakpointCritChance'
  | 'statusDamage'
  | 'statusDuration'
  | 'punchThrough'
  | 'projectileSpeed'
  | 'ammoMax'
  | 'ammoEfficiency'
  | 'zoom'
  | 'recoil'
  | 'accuracy'
  | 'comboDuration'
  | 'comboInitial'
  | 'meleeRange'
  | 'heavyWindup'
  | 'heavyDamage'
  | 'slamDamage'
  | 'finisherDamage'
  | 'critOnSlide'
  | 'slashOnCrit'
  | 'impactToSlash'
  | 'impactToMagnetic'
  | 'explosionRadius'
  | 'beamRange'
  | 'movementSpeed'
  | 'abilityStrength'
  | 'abilityDuration'
  | 'abilityEfficiency'
  | 'energyRegen'
  | 'healthPerHit'
  | 'lifeSteal'
  | 'comboChance'
  | 'armorStrip'
  | 'armorFlatStrip'
  | `elemental:${DamageType}`
  | `physical:${DamageType}`;

export type ModUnit = 'percent' | 'flat' | 'multiplier';

export type StatKind = 'normal' | 'functional' | 'conditional' | 'special' | 'skip';

export interface StatMapping {
  stat: ModStatId;
  /** 落在哪个乘区；null = 不参与伤害汇总 */
  bucket: BucketId | null;
  unit: ModUnit;
  kind: StatKind;
  note?: string;
}

const ELEMENT_KEYS = ['heat', 'cold', 'electric', 'toxin', 'blast', 'gas', 'magnetic', 'radiation', 'corrosive', 'viral'] as const;
const PHYSICAL_KEYS = ['impact', 'puncture', 'slash'] as const;

/** 简写：只关心 stat/unit/kind 时用 */
const m = (stat: ModStatId, bucket: BucketId | null, unit: ModUnit, kind: StatKind, note?: string): StatMapping =>
  note === undefined ? { stat, bucket, unit, kind } : { stat, bucket, unit, kind, note };

const TABLE: Record<string, StatMapping> = {
  // ======== 核心伤害乘区（normal） ========
  dmg: m('baseDamage', 'baseDamage', 'percent', 'normal', '基伤，不限槽位全部相加（第 2.1 节）'),
  ms: m('multishot', 'multishot', 'percent', 'normal', '独立乘区，与基伤相乘（第 2.2 节）'),
  cc: m('critChance', 'critChance', 'percent', 'normal'),
  cd: m('critMultiplier', 'critMultiplier', 'percent', 'normal'),
  sc: m('statusChance', 'statusChance', 'percent', 'normal'),

  // ======== 元素 / 物理（第 4 节：按类型各自维护变量） ========
  ...Object.fromEntries(ELEMENT_KEYS.map((k) => [k, m(`elemental:${k}` as ModStatId, 'elemental', 'percent', 'normal')])),
  ...Object.fromEntries(
    PHYSICAL_KEYS.map((k) => [
      k,
      m(`physical:${k}` as ModStatId, 'physical', 'percent', 'normal', '加量基数是该类型自身面板值'),
    ]),
  ),

  // ======== 覆盖伤害的条件加成 ========
  // 镀层/异况类：加量 = 每层值 × 叠层上限 × 目标身上的异常状态**种类数**。
  // 每张卡的（每层值, 叠层上限）按 Mod 描述确认（需求方 2026-11-06）：
  //   异况超量 80 × 1、镀层 步枪才能 40 × 2、镀层 通晓霰弹枪 40 × 2、镀层 准确射手 40 × 3。
  // 数据层产出的 `levelValues` 满级 = 每层值 × 层数，见 `CO_OVERLOAD_PER_STACK`。
  co: m('baseDamage', 'baseDamage', 'percent', 'conditional', '每层 × 叠层上限 × 目标异常状态种类数（不吃灵化基伤与 AoE，第 2.1 节）'),
  fac: m('faction', 'faction', 'percent', 'normal', '派系乘区；DoT 上生效两次（第 5.3 节）'),
  weak: m('weakpointDamage', null, 'percent', 'conditional', '对弱点伤害，按第 3.2 节爆头倍率结算，不进总和'),
  weakcc: m('weakpointCritChance', 'critChance', 'percent', 'conditional', '仅在命中弱点时生效'),
  weakness: m('weakpointDamage', null, 'percent', 'special', 'Sentient 切口：按目标弱点附加伤害，不与其他伤害类型复合'),
  sd: m('statusDamage', 'baseDamage', 'percent', 'normal', '异常状态伤害 +X%（第 6.3 节）'),
  statusDmg: m('statusDamage', 'baseDamage', 'percent', 'normal', '异常状态伤害 +X%（第 6.3 节）'),
  statusDur: m('statusDuration', null, 'percent', 'functional', '影响 DoT 时长与火焰削甲时长'),
  finisher: m('finisherDamage', 'baseDamage', 'percent', 'conditional', '仅处决攻击'),
  heavy: m('heavyDamage', 'baseDamage', 'percent', 'conditional', '仅重击'),
  msd: m('slamDamage', 'baseDamage', 'percent', 'conditional', '仅震地攻击'),
  firstShot: m('baseDamage', 'baseDamage', 'percent', 'conditional', '弹匣第一发生效'),
  lastShot: m('baseDamage', 'baseDamage', 'percent', 'conditional', '弹匣最后一发生效'),
  br: m('critChance', 'critChance', 'percent', 'conditional', '暴率 × 连击倍率（急进猛突）'),
  scc: m('statusChance', 'statusChance', 'percent', 'conditional', '触发率 × 连击倍率（创口溃烂）'),
  slideCrit: m('critOnSlide', 'critChance', 'percent', 'conditional', '滑砍时生效'),
  critslash: m('slashOnCrit', null, 'percent', 'conditional', '猎人的战备：暴击时按几率附加切割异常，是触发源而非伤害加量'),
  slconv: m('impactToSlash', null, 'percent', 'special', '冲击异常按几率转切割（内部出血 / 失血）；射速 <2.5 时翻倍'),
  magconv: m('impactToMagnetic', null, 'percent', 'special', '冲击异常按几率转磁力（磁化冲击）；射速 <2.5 时翻倍'),
  altCC: m('critChance', 'critChance', 'percent', 'conditional', '仅作用于下一发特殊射击'),
  altCD: m('critMultiplier', 'critMultiplier', 'percent', 'conditional', '仅作用于下一发特殊射击'),
  altDmg: m('baseDamage', 'baseDamage', 'percent', 'conditional', '特殊攻击的额外伤害'),
  altFrate: m('fireRate', 'fireRate', 'percent', 'conditional', '仅副射击模式'),
  killRel: m('reloadSpeed', 'utility', 'percent', 'conditional', '命中条件后限时生效'),
  secCC: m('critChance', 'critChance', 'percent', 'special', '作用于配对的副武器'),
  secSC: m('statusChance', 'statusChance', 'percent', 'special', '作用于配对的副武器'),
  secRel: m('reloadSpeed', 'utility', 'percent', 'special', '作用于配对的副武器'),
  secMag: m('magazine', 'utility', 'percent', 'special', '作用于配对的副武器'),

  // ======== 射速 / 数量 / 火力相关 ========
  frate: m('fireRate', 'fireRate', 'percent', 'normal', '弓类描述为 ×2，另行处理'),
  rel: m('reloadSpeed', 'utility', 'percent', 'functional', '换弹速度，非换弹时间'),
  mag: m('magazine', 'utility', 'percent', 'functional'),
  magFlat: m('magazine', 'utility', 'flat', 'functional', '固定加弹匣数'),
  windup: m('heavyWindup', 'fireRate', 'percent', 'functional', '重击蓄力速度，走射速额外乘区'),
  comboDur: m('comboDuration', 'utility', 'flat', 'functional', '单位：秒'),
  combo: m('comboInitial', 'utility', 'flat', 'functional', '初始连击数'),
  ccc: m('comboChance', 'utility', 'percent', 'functional', '连击数加成几率，不影响伤害'),
  parryAngle: m('comboDuration', null, 'flat', 'functional', '招架角度（度），不影响伤害'),
  airRange: m('meleeRange', 'utility', 'flat', 'functional', '空中近战范围 +X 米'),

  // ======== 手感 / 功能类 ========
  punch: m('punchThrough', 'utility', 'flat', 'functional', '单位：米'),
  projSpeed: m('projectileSpeed', 'utility', 'percent', 'functional'),
  ps: m('projectileSpeed', 'utility', 'percent', 'functional', '弹速 / 光束射程'),
  beamr: m('beamRange', 'utility', 'flat', 'functional', '光束射程（米）'),
  ammo: m('ammoMax', 'utility', 'percent', 'functional'),
  ammoeff: m('ammoEfficiency', 'utility', 'percent', 'functional'),
  ammoc: m('ammoMax', null, 'percent', 'special', '弹药转换：拾取弹药按比例转换，不改弹匣'),
  zoom: m('zoom', 'utility', 'percent', 'functional'),
  recoil: m('recoil', 'utility', 'percent', 'functional', '负值 = 减小后坐力'),
  acc: m('accuracy', 'utility', 'percent', 'functional'),
  range: m('meleeRange', 'utility', 'flat', 'functional', '单位：米'),
  hrel: m('reloadSpeed', 'utility', 'percent', 'functional', '收起武器时的换弹速度'),
  aradius: m('explosionRadius', null, 'percent', 'functional', 'AoE 半径；衰减参数仍需人工补（data-todo 第 1 节）'),
  movesp: m('movementSpeed', null, 'percent', 'special', '移动速度，不影响伤害'),

  // ======== 明确不参与伤害计算 ========
  spread: m('accuracy', 'utility', 'percent', 'skip'),
  sspread: m('accuracy', 'utility', 'percent', 'skip'),
  bounce: m('projectileSpeed', null, 'percent', 'skip'),
  bounceR: m('projectileSpeed', null, 'percent', 'skip'),
  bounceExp: m('projectileSpeed', null, 'percent', 'skip'),
  stagger: m('recoil', null, 'percent', 'skip'),
  noise: m('accuracy', null, 'percent', 'skip'),

  // ======== 武器专属机制（special / conditional） ========
  syndRadial: m('baseDamage', null, 'percent', 'special', '集团特效的满额加成（3 级生效），触发叠层另算'),
  tkEnable: m('heavyDamage', null, 'percent', 'special', 'Tennokai：开启时机'),
  tkChance: m('heavyDamage', null, 'percent', 'special', 'Tennokai：出现几率'),
  tkCd: m('heavyDamage', null, 'percent', 'special', 'Tennokai：时机暴伤'),
  tkDmg: m('heavyDamage', null, 'percent', 'special', 'Tennokai：攻击伤害'),
  tkSC: m('statusChance', null, 'percent', 'special', 'Tennokai：仅时机攻击的触发'),
  tkEvery: m('heavyDamage', null, 'flat', 'special', 'Tennokai：每 X 次攻击必出'),
  tkWin: m('heavyDamage', null, 'flat', 'special', 'Tennokai：时机窗口秒数'),
  djRefresh: m('baseDamage', null, 'percent', 'skip'),  disarm: m('baseDamage', null, 'percent', 'skip'),
  explodeChance: m('explosionRadius', null, 'percent', 'special', '几率爆炸'),
  explodeKill: m('explosionRadius', null, 'percent', 'special', '击杀时爆炸，独立于面板伤害'),
  acid: m('explosionRadius', null, 'percent', 'special', '击杀爆炸按腐蚀 + 敌人最大生命'),
  napalm: m('explosionRadius', null, 'percent', 'special', '燃烧弹覆盖范围'),
  massStore: m('baseDamage', null, 'percent', 'special', '蓄积伤害后引爆'),
  sacCap: m('baseDamage', null, 'percent', 'special', '可蓄积伤害上限'),
  energyConv: m('baseDamage', null, 'percent', 'special', '消耗能量转化为额外伤害'),
  tether: m('explosionRadius', null, 'flat', 'special', '榴弹索敵人数'),
  slamPull: m('explosionRadius', null, 'flat', 'special', '震地拉扯范围（米）'),
  killTrap: m('explosionRadius', null, 'flat', 'special', '击杀生成陷阱持续时间'),
  falloff: m('explosionRadius', null, 'percent', 'special', '衰减距离'),
  strip: m('armorStrip', null, 'percent', 'special', '直接削减周围敌人护甲/护盾比例'),
  stripA: m('armorFlatStrip', null, 'flat', 'special', '冲击伤害固定削甲点数'),
  lifesteal: m('lifeSteal', null, 'percent', 'special', '生命吸取'),
  healProc: m('healthPerHit', null, 'flat', 'special', '每个异常状态回血'),
  parryFin: m('finisherDamage', null, 'percent', 'special', '招架后开启处决'),
  nullifier: m('baseDamage', null, 'percent', 'special', '击破 Nullifier 护盾发生器'),
  orbDrop: m('baseDamage', null, 'percent', 'special', '死亡掉落球体'),
  allyBuff: m('baseDamage', null, 'percent', 'special', '给队友的增益'),
  allyBuffD: m('baseDamage', null, 'percent', 'special', '给队友的增益'),
  abStr: m('abilityStrength', null, 'percent', 'special', '技能强度，属战甲层，见 README 范围约定'),
  abDur: m('abilityDuration', null, 'percent', 'special', '技能持续时间，属战甲层'),
  abEff: m('abilityEfficiency', null, 'percent', 'special', '技能效率，属战甲层'),
  abRegen: m('energyRegen', null, 'flat', 'special', '能量回复，属战甲层'),
};

/**
 * 镀层 / 异况类模组的**满级基伤加成**（每张卡、每种异常状态）。
 *
 * 需求方 2026-11-06：「镀层步枪才能应该 80% 伤害/异常状态…其他的镀层基伤 mod 也要修改下」
 *
 * 旧的 ZKMODS 值（20 / 30 / 80）口径各不相同，无法当成"每张卡的真实数值"，
 * 因此在这里统一登记；流水线产出时按这个值重写 `levelValues`（第 r 级 = 80 × r / 等级上限）。
 */
/**
 * 需求方指定的**数值订正**（ZKMODS id → 满级值 + 理由）。
 * 逐级仍按线性重算（第 r 级 = 满级 × r / 等级上限）。
 */
export const MOD_VALUE_OVERRIDES: Readonly<Record<string, { maxValue: number; reason: string }>> = {
  // 需求方 2026-11-06：「幽灵膛线满级是 330 对的，每级 30%」→ 0,30,60,…,330
  spectral_serration: { maxValue: 330, reason: 'ZKMODS 的 p 只给了 0~10（把每级值当成了满级值），满级应为 +330%' },
};

/**
 * 镀层 / 异况类模组的**每层基伤加成**（每张卡、每种异常状态，单位 %）。
 *
 * 需求方 2026-11-06 两轮澄清：
 *   「镀层步枪才能应该 80% 伤害/异常状态」
 *   「不是每张 mod 都是 80，步枪才能是因为一层 40 最多两层所以是 80，其他的也关注 mod 描述」
 *   「准确射手是 120」→ 每层 40% × 3 层 = 120%。
 * 所以**不能**把四张卡都写死成 80，要按各自的（每层值 × 叠层上限）算满层值：
 *
 * | Mod | 每层 | 叠层上限 | 满层 |
 * |---|---|---|---|
 * | 异况超量 Condition Overload | 80% | 1（常驻） | 80% |
 * | 镀层 步枪才能 Galvanized Aptitude | 40% | 2 | 80% |
 * | 镀层 通晓霰弹枪 Galvanized Savvy | 40% | 2 | 80% |
 * | 镀层 准确射手 Galvanized Shot | 40% | 3 | **120%** |
 *
 * 叠层上限取自 `conditions[].maxStacks`（异况超量没有 conditions → 1）。
 */
export const CO_OVERLOAD_PER_STACK: Readonly<Record<string, number>> = {
  condition_overload: 80,
  galvanized_aptitude: 40,
  galvanized_savvy: 40,
  galvanized_shot: 40,
};

/** 镀层 / 异况类：每层值（未登记的卡返回 null，退回 ZKMODS 原值） */
export function coOverloadPerStack(modId: string): number | null {
  return CO_OVERLOAD_PER_STACK[modId] ?? null;
}

/** 该属性键是否为镀层 / 异况类基伤 */
export function isConditionOverloadKey(key: string): boolean {
  return key === 'co';
}

export const ALL_ELEMENT_KEYS = ELEMENT_KEYS;
export const ALL_PHYSICAL_KEYS = PHYSICAL_KEYS;

/**
 * 查映射。
 * @returns StatMapping；undefined = 未登记，需要人工确认（流水线会汇总上报）
 */
export function lookupStat(key: string): StatMapping | undefined {
  return Object.hasOwn(TABLE, key) ? TABLE[key] : undefined;
}

/** 全部已登记键（供测试与文档核对） */
export function registeredKeys(): string[] {
  return Object.keys(TABLE);
}

/** 是否属于"进伤害汇总"的键（normal 才算常驻乘区） */
export function isNormalStat(key: string): boolean {
  return lookupStat(key)?.kind === 'normal';
}
