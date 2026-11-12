/**
 * WFCD 武器清洗路径（数据层切换实验，**尚未替换 clean.ts**）。
 *
 * 口径（需求方 2026-11-11 确认）：
 *   1. 一个射击模式 = 一个面板：主模式、灵化各一个；一个模式里的多段**相加**后结算。
 *   2. 射线**不再用 `beam` 标记**，由扳机决定：
 *        · 模式扳机 = `Held`            → 该模式是射线（持续射击）
 *        · 攻击名含 `Held`（灵化射线）  → 该攻击所在模式是射线
 *   3. 范围伤害由 `shot_type === 'AoE'` 判定，不再用 stateName 推断；AoE 段不吃镀层。
 *   4. 次要模式与主模式共用弹匣/装填；灵化模式没有弹匣/装填（充能弹药不建模）。
 *   5. `attacks[].status_chance` 是**单弹片**触发率（野猪 Prime 11.25% 与面板一致），
 *      段上原样保存，不做整发合并。
 *
 * 模式划分（按 WFCD 攻击名，而不是按武器名）：
 *   · 主攻击锚点：Normal Attack / Auto / Buckshot / Fully Spooled / Single Pellet /
 *     Semi-Auto Mode / Full Auto Mode / Primary / Primary-Fire / Beam / Held / First Attack…
 *     —— 名字是字面意思：Radial / Explosion / AoE / Detonation / Cloud 是**同一模式内的段**，
 *        Alt-Fire / Burst / Secondary Fire / Charged Shot / Quick Shot / Uncharged Shot 是**独立模式**。
 *   · 0 个独立模式锚点时，退化为「一个射击模式」：无爆发的攻击归主模式，带爆发的另起；
 *     Barrage / Quill / 导弹类攻击按「按名字切换」处理，各自成一个模式（不合并相加）。
 */
import type { AttackMode, DamageSegment, ModeRole, ModeVariant, PanelOverride, TriggerKind, Weapon } from '../../core/src/weapon.ts';
import type { DamageSpread, DamageType } from '../../core/src/damage-types.ts';

// ─────────────────────────────────────────────────────────────
// WFCD 原始类型（只声明用到的字段）
// ─────────────────────────────────────────────────────────────

export interface WfcdAttack {
  name: string;
  speed?: number;
  crit_chance?: number;
  crit_mult?: number;
  status_chance?: number;
  shot_type?: 'Hit-Scan' | 'Projectile' | 'AoE' | string | undefined;
  shot_speed?: number;
  flight?: number;
  charge_time?: number;
  falloff?: { start: number; end: number; reduction: number };
  damage?: Record<string, number>;
}

export interface WfcdWeapon {
  name: string;
  uniqueName: string;
  productCategory?: string;
  slot?: string;
  trigger?: string;
  critChance?: number;
  criticalChance?: number;
  criticalMultiplier?: number;
  procChance?: number;
  fireRate?: number;
  magazineSize?: number;
  reloadTime?: number;
  multishot?: number;
  accuracy?: number;
  tags?: string[];
  isPrime?: boolean;
  /** 武器类型（`Shotgun` / `Bow` / `Zaw Component` …），用于收录边界判定 */
  type?: string;
  /** 是否可精通；`false` 的一般是 PvP 变体或非正式武器 */
  masterable?: boolean;
  /** D-152：来源文件（`Primary` / `Melee` …），由 `fetchAllWfcdWeapons` 填入，用于槽位判定纠错 */
  __source?: string;
  attacks?: WfcdAttack[];
}

// ─────────────────────────────────────────────────────────────
// 伤害类型键
// ─────────────────────────────────────────────────────────────

/** WFCD 伤害键（小写英文）→ 内核 DamageType */
const DAMAGE_KEY: Readonly<Record<string, DamageType>> = {
  impact: 'impact',
  puncture: 'puncture',
  slash: 'slash',
  heat: 'heat',
  cold: 'cold',
  electricity: 'electric',
  toxin: 'toxin',
  blast: 'blast',
  radiation: 'radiation',
  gas: 'gas',
  magnetic: 'magnetic',
  viral: 'viral',
  corrosive: 'corrosive',
  void: 'void',
  tau: 'tau',
};

// ─────────────────────────────────────────────────────────────
// 扳机
// ─────────────────────────────────────────────────────────────

/** WFCD 扳机值 → 内核 TriggerKind；`Held` 是射线 */
export function toTrigger(raw: string | undefined | null): TriggerKind {
  const t = String(raw ?? '').trim().toLowerCase();
  if (!t) return 'unknown';
  if (t === 'held') return 'held';
  if (t === 'auto') return 'auto';
  if (t === 'semi') return 'semi';
  if (t === 'burst' || t === 'auto burst') return 'burst';
  if (t === 'charge' || t === 'duplex') return 'charge';
  if (t === 'active') return 'active';
  return 'unknown';
}

/** 该攻击是不是射线形态：攻击名带 `Held`（如 `Incarnon Form Held Damage`） */
export function isHeldAttack(name: string): boolean {
  return /\bHeld\b/i.test(name);
}

/* 该模式是否射线。
 *
 * 判据（需求方 2026-11-11，逐条确认过）：
 *   · 扳机 = `Held` → 射线（持续射击）；
 *   · 攻击名含 `Held` 且 `shot_type` 不是 `AoE` → 射线
 *     （`Incarnon Form Held Damage` = 灵化射线；`Incarnon Form Charge Radial Attack` 是范围伤害，不算）。
 *
 * 不按 `Incarnon` / `Radial` / `Alt-Fire` 的名字做任何附加推断——
 * 原子矿融炮 / 咖玛腕甲枪的灵化是 `Incarnon Form`(投射物) + `Incarnon Form Radial Attack`(AoE)，不是射线。
 * 绘墨：主模式（扳机 Held）是射线，`Alt-Fire`(投射物) 与 `Alt-Fire Radial Attack`(AoE) 不是。
 * 巴什穆：扳机 Auto，只有名为 `Held` 的那一条攻击是射线（次要射击）。
 */
export function isBeamMode(mode: AttackMode): boolean {
  if (mode.trigger === 'held') return true;
  // 攻击名含 Held 的段必须是"射线形态"而不是范围伤害（`x Held Damage` 算，`x Held Radial Attack` 不算）
  return (mode as AttackMode & { _beamAttacks?: boolean })._beamAttacks === true;
}

// ─────────────────────────────────────────────────────────────
// 模式划分
// ─────────────────────────────────────────────────────────────

/** 主攻击锚点：它们是「射击模式本身」，不带"另一个模式"的语义 */
const PRIMARY_ANCHORS: readonly RegExp[] = [
  /^Normal Attack$/i,
  /^Auto$/i,
  /^Auto Burst$/i,
  /^Auto-Burst$/i,
  /^Buckshot$/i,
  /^Fully Spooled$/i,
  /^Single Pellet$/i,
  /^Semi-Auto Mode$/i,
  /^Full Auto Mode$/i,
  /^Primary$/i,
  /^Primary-Fire$/i,
  /^Beam$/i,
  /^Held$/i,
  /^First Attack$|^Second Attack$|^Third Attack$/i,
  /^Normal Radial Attack$/i,
];

/** 独立模式的锚点：名字本身表示"另一种射击方式" */
const SEPARATE_MODE: readonly RegExp[] = [
  /^Incarnon Form/i, // 灵化形态：独立面板
  /Alt-Fire/i,
  /Secondary Fire/i,
  /^Burst$/i,
  /^Burst Shot$/i,
  /^Burst Mode$/i,
  /^Burst-Fire/i,
  /^Full-Auto$/i,
  /^Charged Shot$/i,
  /^Quick Shot$/i,
  /^Uncharged Shot$/i,
  /^Uncharged Horizontal\/Vertical Shot$/i,
  /^Charged Horizontal\/Vertical Shot$/i,
  /^Perfect Shot$/i,
  /^Single Rocket Impact$/i, // 蓄力火箭：主模式（其爆炸是同模式内的段）
  /^Barrage Mode$/i,
  /^Quill$/i,
  /^Poison Quill$|^Fire Quill$|^Electric Quill$|^Ice Quill$/i,
  /^Charge$/i,
  /^Horizontal Spread$/i,
  /^Spear Throw$/i, // 已有 "Spear Throw Impact" 时会被下面的同义合并处理
];

/**
 * **扳机词**：攻击名本身就是「一种扳机」的攻击，各算一个独立射击模式（D-150）。
 *
 * 需求方 2026-11-12：
 * > 「雌鹿射击模式不对，他是三个模式，有两个当成一个段了。一个射击模式一般只会有一个投射物命中。」
 *
 * 雌鹿（Hind）在 WFCD 里的三条攻击是 `Burst Mode` / `Semi-Auto Mode`（正式版）
 * 与 `Burst` / `Semi-Auto` / `Auto`（赤毒·雌鹿、狂鲨 Prime）。这些名字既不是主攻击锚点，
 * 也不在 `SEPARATE_MODE` 里，旧逻辑把它们全并进第一个模式、当成「同一模式的多种攻击方式」，
 * 于是 3 个射击模式塌成 2 个（狂鲨 Prime 只是因为名字里带 `Auto` 蹭到了 `/Alt-Fire/i` 才碰巧拆开）。
 *
 * ⚠ 与 `PRIMARY_ANCHORS` 的分工：锚点是「射击模式本身」的名字（`Auto` / `Burst`…），
 * 描述的是**第一个**模式；扳机词是「换了扳机」，每一段都该自成一个模式。
 * 判据放最后、且排除锚点，所以 `Auto` / `Burst` 这类先被锚点吃掉，不会重复开组。
 */
const TRIGGER_NAMES: readonly RegExp[] = [
  /^(Burst|Burst Mode|Burst Shot|Burst-Fire( While Aiming)?)$/i,
  /^(Semi-Auto|Semi-Auto Mode|Semi|Semi-Auto Fire)$/i,
  /^(Auto|Auto Mode|Full-Auto|Full Auto Mode|Fully Automatic)$/i,
  /^(Alt-Fire|Secondary Fire)$/i,
  /^(Charged Attack|Charge Attack)$/i,
  /^(Lock-on Mode|Barrage Mode)$/i,
];

/**
 * 「独立弹道」：一种**自己飞出去的单发攻击**（鱼叉 / 长矛 / 榴弹 / 信标…）。
 *
 * 需求方 2026-11-12：「附肢寄生者那个是**感染鱼叉**」→ 同时选择了「鱼叉也单开成一个射击模式
 * （像信标、炮台那样）」。WFCD 只把 `Infested Harpoon` 挂了 `Projectile`，
 * `Infested Harpoon Contact` 没有 `shot_type`——前者开组，后者作为子段跟进来，最后按数值去重。
 */
const isOwnProjectile = (a: WfcdAttack): boolean => String(a.shot_type ?? '').toLowerCase() === 'projectile';

/** 这条攻击是不是范围伤害（`shot_type === 'AoE'`，或 WFCD 漏标但确定是 AoE 的那几条） */
const isAoEAttack = (a: WfcdAttack): boolean =>
  String(a.shot_type ?? '').toLowerCase() === 'aoe' || forcedAoe(a.name);

/**
 * 这类名字是「另一个模式自己的子段」，**不是**独立弹道（D-150）。
 *
 * 钩铳的 10 点命中附带、磁道炮的吸引场、量子切割器的方块引爆都属此类：
 * 它们的名字不像主攻击、又有 `shot_type: 'Projectile'`，但确实是同一次开火的一部分。
 *
 * ⚠ 钉成**具体名字**而不是词形（`\bRadial Attack$` / `Cluster Bomb`）——否则
 *   异化者的 `Partial Reload Explosion`、量子切割器的 `Cube Explosion`、沙皇的
 *   `Cannon Mode Cluster Bomb` 都会被拆成独立模式，把上一轮已经确认的划法弄反。
 */
const SUBPART_NAMES = /^(Attraction Field|Cube Explosion|Cube \(shot by player\)|Cannon Mode Explosion|Cannon Mode Cluster Bomb Explosion|Incarnon Form Radial Attack|Radial Attack|Auto Radial Attack)$/i;

/**
 * **按名字独立成模式的「附属攻击」**（D-150，需求方 2026-11-12）。
 *
 * 需求方：「信标、炮台独立成模式」。
 * ```
 * 巴兹火枪   Normal Attack 30/24/6   +  Beacon 穿刺 3          → 2 个模式
 * 方位角     Normal Attack 2/5/13    +  Turret Expiry 爆 75    → 2 个模式
 * ```
 * 它们不是「同一次开火的子段」：信标是打在敌人身上的标记镖、炮台是投出去持续射击的物件，
 * 各自有独立的触发时机，所以跟扳机词一样各算一个射击模式。
 *
 * ⚠ 其余「附属段」仍留在原模式里：`Infested Harpoon Contact`（附肢寄生者的鱼叉命中子段）、
 *   `Attraction Field`（磁道炮的吸引场）、`Cube (shot by player)`（量子切割器的引爆）。
 */
const SIDE_ATTACK_NAMES: readonly RegExp[] = [/^Beacon$/i, /^Turret( Expiry)?$/i];

/**
 * **开镜模式**（D-150 第四轮，需求方 2026-11-12）：
 * > 「换，开镜以后不是一个模式了」
 *
 * 猛毒（Komorex）在 WFCD 里是 `Normal Attack`（冲击 96.9）+ `3.5x Zoom Radial Attack`（病毒 53）。
 * 开镜换的是**整个弹种与面板**，不是同一次开火里的爆炸段——所以名字里带 `X Zoom` / `Scoped`
 * 的攻击自成一个射击模式（`shot_type` 在 WFCD 里是缺的，不能靠它判）。
 *
 * ⚠ 名字表只认「zoom / scoped」这类**明确的倍镜标记**：`Alt-Fire` / `Radial Attack` 之类
 *   仍走原来的规则，避免把普通的副模式／爆炸段误拆。
 */
const ZOOM_ATTACK_NAMES: readonly RegExp[] = [/\b\d+(\.\d+)?x\s+zoom\b/i, /\bzoomed\b|\bscoped\b/i];

/**
 * 「独立弹道」的名字（D-150 第二轮，需求方 2026-11-12 晚）：
 * > 「鱼叉也单开成一个射击模式（像信标、炮台那样）」
 *
 * 判据是需求方的原话：「一个射击模式一般只会有一个投射物命中，只有赘骨的灵化是个例外」。
 * 一条攻击**自己飞出去**（`shot_type === 'Projectile'`）、名字又不是主锚点 / 扳机词 / 既有的
 * 附属攻击（信标 / 炮台）→ 它跟主射击并列，单开一个模式；它带 `Explosion` 子段的话跟随在它下面。
 *
 * ⚠ 与 `SIDE_ATTACK_NAMES` 的分工：信标 / 炮台在 WFCD 里分别是 `Projectile` / 无 shot_type，
 *   走名字表；这里的弹道靠 `shot_type` 判，名字表只管「哪些名字看起来像弹道」。
 */
const isBallisticAim = (a: WfcdAttack): boolean => isOwnProjectile(a) && !isAoEAttack(a);

/**
 * 一条弹道自己的 **AoE 子段**（`Ranged Attack` 的 `Ranged Attack Explosion`）：
 * 名字以它的名字开头（含主干去掉子段词后相同）的那条 AoE。只有这类才跟随弹道单开模式。
 */
function isOwnAoeChild(parentName: string, childName: string): boolean {
  const stem = (n: string): string => String(n ?? '').toLowerCase().replace(/\s*radial attack$/, '').trim();
  const p = stem(parentName);
  const c = stem(childName);
  return c === p || c.startsWith(p + ' ');
}

/**
 * 上面这条路是「跟随父弹道」的命名依据；当前实现里「`xxx Explosion` / `xxx Contact`
 * 紧随弹道」本身就由 `BOMB_SWITCH` 与「归当前组」规则覆盖，`isOwnAoeChild` 留作
 * 其它需要按名字判定从属关系的场合（例如核对导出顺序反常的情况）。
 */
void isOwnAoeChild;

/** 中文名查表用（模式名 / 攻击方式名共用） */
function zhOf(name: string): string | undefined {
  return ZH_OF[String(name ?? '').trim().toLowerCase()];
}

/** 同义/从属关系：带这些词的是「另一个模式的段」，不是新模式 */
const SUBPART: readonly RegExp[] = [
  /Radial Attack/i,
  /Explosion|Explode|Detonation/i,
  /AoE$/i,
  /Contact/i,
  /Impact$/i,
  /Cloud|Field/i, // 毒云 / 冰场
  /Damage over Time/i,
  /Merging/i, // 奇点枪融合伤害
  /Spear Throw/i,
  /^Orb /i,
];

/**
 * 「按名字切换的弹种」：名字本身就是一个独立的射击方式，但**不在** `SEPARATE_MODE` 里。
 *
 * 典型是幻离子（Phantasma）：`Plasma Bomb Impact / Plasma Bomb Explosion /
 * Cluster Bombs Impact / Cluster Bombs Explosion` 是它的**副模式子母弹**，
 * 主模式是一条射线（`Beam`）。之前这些名字既不是锚点也不匹配 `SEPARATE_MODE`，
 * 于是被 `.` 之后的「挂到前一个锚点」规则吞进了射线主模式 ——
 * 结果射线主模式里混进了 15/73/3/18 四段子母弹伤害，主模式伤害虚高。
 *
 * 判据取「名字的第一个词」：同一把武器里，凡是以某个**非主锚点首词**开头的攻击，
 * 若该首词不是 SUBPART（Impact/Explosion/AoE…），就以它为首起一个独立模式，
 * 其后同首词的攻击（含 Explosion / Impact 等子段）都归这个模式。
 *
 * 例：`Plasma Bomb Impact` → 首词 `Plasma`，且不是 SUBPART → 新模式；
 *     `Plasma Bomb Explosion` → 同首词 → 归上一个 `Plasma` 模式。
 *     `Semi-Auto Mode` → 扳机词（`TRIGGER_NAMES`）→ 自成模式（D-150，雌鹿三模式）。
 */
const BOMB_SWITCH = /^(Plasma Bomb|Cluster Bombs?|Cluster|Bomb|Grenade|Rocket|Missile|Charge Bombs?)/i;

/**
 * 「按主词切换的弹种」：命中的攻击**自己起一个新模式**，不是当前模式的子段。
 *
 * 需求方 2026-11-12：量子切割器是 **2 个模式**——模式 1 是射线（`Beam`），
 * 模式 2 是方块弹的 3 段（`Cube (direct hit)` / `Cube Explosion` / `Cube (shot by player)`）。
 *
 * 与 `BOMB_SWITCH` 的区别在这里：子母弹（`Plasma Bomb`）是**同一次射击的后续子段**，
 * 归当前模式即可；方块弹则要**独立成一个模式**（共用弹匣，件数/换弹节奏不同）。
 *
 * 例：`Cube (direct hit)` → 首词 `Cube` → 开新模式；`Cube Explosion` / `Cube (shot by player)` 归它。
 */
const SIDE_WEAPON = /^(Cube|Quill)\b/i;

/**
 * 按主词「换了一种发射方式」的分组：同一次射击的命中 / 爆炸算同一段。
 *
 * 需求方 2026-11-12：异化者（Catabolyst）是 **2 个模式**——
 * 模式 1 是射线（`Primary`），模式 2 按**换弹方式**分 4 段：
 * ```
 * Partial Reload    Impact 冲 11 + Explosion 腐蚀 203
 * Reload From Empty Impact 冲 11 + Explosion 腐蚀 1997   ← 空弹匣换弹的爆炸更高
 * ```
 * WFCD 原文本来就把这 5 条攻击拆开了，只是名字主干不同（`Partial Reload` / `Reload From Empty`），
 * 旧代码按「命中 / 爆炸」两层分组，把它们压成了 4 个"攻击方式"（两个 impact、两个爆炸），
 * 看不出是按换弹方式区分的。
 */
const THROW_SWITCH = /^(Partial Reload|Reload From Empty)\b/i;

const matchesAny = (name: string, list: readonly RegExp[]): boolean => list.some((re) => re.test(name));

/**
 * WFCD 攻击名 → 中文名（需求方：界面一律中文）。
 *
 * 两个用途（D-150）：
 *   1. 攻击方式标签（`直接命中` / `范围伤害（集束炸弹）`）；
 *   2. **模式名**：拆出来的副模式用触发它的那条攻击名当名字
 *      ——「信标」「炮台」「感染鱼叉」都是模式名，不是攻击方式名。
 *
 * 空串 = 锚点名（`Normal Attack`），只用于「直接命中」判定，不当模式名。
 */
const ZH_OF: Readonly<Record<string, string>> = {
  'normal attack': '',
  'normal': '',
  'primary': '',
  'incarnon form': '',
  'incarnon form held': '射线',
  'incarnon form charge': '蓄力',
  'incarnon form held damage': '射线',
  'incarnon form charge attack': '蓄力',
  'plasma bomb': '等离子炸弹',
  'cluster bombs': '集束炸弹',
  'grenade': '榴弹',
  'poison cloud': '毒云',
  'radial attack': '范围伤害',
  'alt-fire': '次要射击',
  'secondary fire': '次要射击',
  'beam': '',
  'beacon': '信标',
  'turret expiry': '炮台',
  // ── D-150 拆出独立模式后，直出英文的次要射击名 ──
  'buckshot': '霰弹',
  'air burst projectile': '空爆弹',
  'auto': '全自动',
  'charged shot': '蓄力',
  'charged shot laser': '蓄力激光',
  'cannon mode projectile': '炮击模式',
  'cannon mode cluster bomb': '炮击模式·集束炸弹',
  'cube (direct hit)': '方块直击',
  'cube explosion': '方块爆炸',
  'cube (shot by player)': '方块引爆',
  'harpoon': '鱼叉',
  'infested harpoon': '感染鱼叉',
  'infested orb': '感染球',
  'spear throw': '投掷长矛',
  'projectile': '投射物',
  'rocket': '火箭',
  'homing spore': '追踪孢子',
  'uncharged': '未蓄力',
  'uncharged projectile': '未蓄力投射物',
  'fully charged projectile': '满蓄力投射物',
  'fully stacked orb singularity': '满层球体奇点',
  'corrosive dot': '腐蚀持续伤害',
  // ── D-150 第二轮：弹道 / 近战飞掷 / 重击弹道（WFCD 的原名，界面一律中文）──
  'contact': '命中',
  'uncharged direct hit': '未蓄力直击',
  'cannon mode cluster bomb contact': '集束炸弹',
  'homing spore contact': '追踪孢子',
  'spectral dagger': '幽灵匕首',
  'spectral blade': '幽灵之刃',
  'spectral axe': '幽灵战斧',
  'corrosive wave': '腐蚀波',
  'energy disk': '能量盘',
  'energy wave': '能量波',
  'ranged attack': '远程攻击',
  'first shockwave': '第一道冲击波',
  'second shockwave': '第二道冲击波',
  'heavy attack glaive': '重击回旋刃',
  'polearm throw': '长柄武器投掷',
  'charged projectile': '蓄力弹',
  'dagger projectile': '匕首弹',
  'soul swarm projectile': '魂群弹',
  'first heavy attack - toxic spines': '重击 I·毒刺',
  'second heavy attack - toxic spines': '重击 II·毒刺',
  'first heavy attack - ethereal daggers': '重击 I·以太匕首',
  'second heavy attack - ethereal daggers': '重击 II·以太匕首',
};

/** 攻击名主干 → 稳定 id（`Partial Reload` → `copartialreload`） */
const slug = (s: string): string =>
  'co' + String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 24);

/**
 * WFCD 没写 `shot_type`、但确定是范围伤害的攻击。
 *
 * 需求方 2026-11-12：「Cube (shot by player) 应该是 aoe」。
 * WFCD 原文对 `Cube (direct hit)` 给了 `Projectile`、对 `Cube Explosion` 给了 `AoE`，
 * 唯独玩家射击引爆这条**没有 `shot_type` 字段**；它带 `falloff{0,6}`，是 6 米范围的引爆，
 * 所以按范围伤害处理（这一段会走爆炸机制、不吃镀层类）。
 */
export function forcedAoe(name: string): boolean {
  return /^Cube\s*\(\s*shot by player\s*\)$/i.test(String(name ?? '').trim());
}


/**
 * 把同一模式内的攻击拆成「攻击方式」（对应内核的 `ModeVariant`）。
 *
 * 需求方 2026-11-12：
 * > 「灵化只有一个，那是一个灵化模式下的多个攻击方式，打出去有弹头命中跟爆炸伤害。」
 * > 「赘骨也只是灵化模式下存在两个扳机，一个是射线一个是蓄力。」
 *
 * 所以一个模式内的攻击不是一股脑相加，而是先按「攻击方式」归类，界面上分开勾选。
 *
 * 归类分两层：
 *   1. **先按伤害判定类型**分：`shot_type === 'AoE'` 的是「爆炸」，其余是「命中」。
 *      需求方要的正是在面板上分开看到「弹头命中」和「爆炸」两行；
 *   2. 同一判定类型里，再按**名字去掉子段词后的主干**细分
 *      （`Plasma Bomb` 与 `Cluster Bombs` 是两种不同的弹种，不该合并）。
 *
 * ```
 * Incarnon Form                 → 命中组
 * Incarnon Form Radial Attack   → 爆炸组     ← 同属灵化模式，但界面分开显示
 * Plasma Bomb Impact            → 命中组「Plasma Bomb」
 * Plasma Bomb Explosion         → 爆炸组「Plasma Bomb」
 * ```
 * 只有一种攻击方式时沿用旧行为：单个 `direct` 变体（界面不显示选择器）。
 */
function groupAttackVariants(attacks: readonly WfcdAttack[]): { id: string; label: string; attacks: WfcdAttack[] }[] {
  /** 末尾的子段词：只用来给「攻击方式」起名，不参与是否分组的判断 */
  const TAIL = /\s*(Impact|Explosion|Explode|Detonation|Radial Attack|AoE|Damage|Contact|Direct Hit|Attack)$/i;

  /** 攻击名的主干（去掉子段词），用于同判定类型内的细分与命名 */
  const stemOf = (name: string): string => {
    let key = String(name ?? '').trim();
    let prev = '';
    while (prev !== key) {
      prev = key;
      key = key.replace(TAIL, '').trim();
    }
    return key || String(name ?? '').trim();
  };

  const isAoe = (a: WfcdAttack): boolean => String(a.shot_type ?? '').toLowerCase() === 'aoe';

  /**
   * 是否按「主词」定段（而不是按「命中 / 爆炸」两层）。
   *
   * 需求方 2026-11-12 的两把武器说明：同一发里 `xxx Impact` 与 `xxx Explosion` 是**同一段的两个子段**，
   * 真正区分它们的是名字的主词（`Partial Reload` / `Reload From Empty` / `Cube`）。
   * 按主词分组之后：
   * ```
   * 量子切割器模式 2 → Cube (direct hit) / Cube Explosion / Cube (shot by player)   三段都在「Cube」组里
   * 异化者模式 2     → Partial Reload(impact+explosion) / Reload From Empty(impact+explosion)
   * ```
   * 其它武器（幻离子子母弹等）**保持旧行为**，按命中 / 爆炸两层分。
   */
  const byStem = attacks.some((a) => THROW_SWITCH.test(String(a.name ?? '')) || /^\s*Cube\b/i.test(String(a.name ?? '')));

  // 先按「命中 / 爆炸」两大层，再按主干细分
  const buckets: { key: string; aoe: boolean; attacks: WfcdAttack[] }[] = [];
  for (const a of attacks) {
    const aoe = isAoe(a);
    const stem = stemOf(a.name);
    const hit = byStem
      ? buckets.find((b) => b.key.toLowerCase() === stem.toLowerCase())
      : buckets.find((b) => b.aoe === aoe && b.key.toLowerCase() === stem.toLowerCase());
    if (hit) hit.attacks.push(a);
    else buckets.push({ key: stem, aoe, attacks: [a] });
  }

  // 只有一种攻击方式 → 单个变体，沿用 direct（与改动前完全一致）
  if (buckets.length <= 1) {
    return [{ id: 'direct', label: '直接命中', attacks: [...attacks] }];
  }

  // 多种：命中组排前、爆炸组排后；id 必须**唯一**（override 与界面勾选都按 id 认）
  // byStem 下**保持 WFCD 原文顺序**——需求方要看的正是「直接命中 → 自然爆炸 → 玩家引爆」这个顺序。
  if (!byStem) buckets.sort((a, b) => Number(a.aoe) - Number(b.aoe));
  const used = new Set<string>();
  return buckets.map((g, i) => {
    // 标签（需求方 2026-11-12）：
    // > 「灵化·爆炸也太蠢了，跟普通模式一样用直接命中 范围伤害这样来区分啊」
    // 所以不再拼「某某·爆炸」，而是和普通模式用同一套叫法：
    //   非 AoE → 直接命中；AoE → 范围伤害。
    // 同一侧有多种时再加原名区分（`等离子炸弹` / `集束炸弹` 都是命中段）。
    const ZH = ZH_OF;
    // 查译名用**原始攻击名**（`Normal Attack`），不是剥过子段词的主干（`Normal`）——
    // 否则 `ZH` 里的 `'normal attack'` 永远匹配不上，标签会漏成英文原名。
    const rawName = String(g.attacks[0]?.name ?? '').trim();
    const zh =
      ZH[g.key.toLowerCase()] ??
      ZH[rawName.toLowerCase()] ??
      // 表外名字：用**原始名**（比剥过子段词的主干可读），仍没有就退回主干
      (rawName || g.key);    // 标签规则（需求方 2026-11-12：用「直接命中 / 范围伤害」区分，别拼「某某·爆炸」）：
    //   · 爆炸段 → 「范围伤害」（多段时后面带原名，如「范围伤害（集束炸弹）」）
    //   · 命中段 → 「直接命中」；但如果这一段换了**发射方式**（射线 / 蓄力），就用那个名字，
    //     否则赘骨灵化里「射线」和「蓄力」都显示成「直接命中」就分不出来了
    const MODE_OF_FIRE = /^(射线|蓄力)$/;
    const isAoeName = g.aoe || g.attacks.some(isAoe);
    const sameSide = buckets.filter((b) => (b.aoe || b.attacks.some(isAoe)) === isAoeName);
    let label: string;
    if (isAoeName) {
      label = sameSide.length <= 1 || !zh ? '范围伤害' : `范围伤害（${zh}）`;
    } else if (MODE_OF_FIRE.test(zh)) {
      label = zh;
    } else if (sameSide.length <= 1 || !zh) {
      label = '直接命中';
    } else {
      // 同一侧多种：用原名区分，去掉「直接命中」前缀以免太长
      label = zh;
    }
    // 同一组里 hitscan 与 AoE 混在一起时，把「范围伤害」标出来（见 toSegment 的 forcedAoe）。
    // 典型是量子切割器模式 2 的三个 Cube 段：名字里没有 Impact / Explosion 可剥，
    // 只剩 `Cube` / `Cube (shot by player)`，不标就看不出哪一段是范围伤害。
    if (byStem) {
      const parts = g.attacks.filter((a) => toSegment(a, [], '') !== null);
      const hasHit = parts.some((a) => !isAoe(a));
      const hasAoe = parts.some((a) => isAoe(a) || forcedAoe(a.name));
      if (hasHit && hasAoe) {
        // 标签是中文，所以名字也要走 ZH（`Cube Explosion` → 「方块爆炸」而不是「Cube」）
        const nameOf = (a: WfcdAttack): string => {
          const raw = String(a.name ?? '').trim();
          return ZH[raw.toLowerCase()] ?? ZH[stemOf(raw).toLowerCase()] ?? raw;
        };
        const aoeParts = parts.filter((a) => isAoe(a) || forcedAoe(a.name)).map(nameOf);
        const allSameStem = new Set(aoeParts.map((s) => s.toLowerCase())).size === 1;
        label = allSameStem
          ? `范围伤害（${aoeParts[0]}）`
          : `范围伤害（${[...new Set(aoeParts)].join(' / ')}）`;
      }
    }
    // id 首选 direct / blast / attackN；重名就加序号，保证唯一
    let id = i === 0 ? 'direct' : g.aoe ? 'blast' : `attack${i + 1}`;
    if (byStem) {
      // byStem 下用**可读的 id**（`copartialreload` / `coreloadfromempty` / `cocube…`），
      // 与攻击名一一对应，排查数据时一眼能认出是哪一段。
      id = slug(g.key);
    }
    if (used.has(id)) {
      let n = 2;
      while (used.has(`${id}${n}`)) n++;
      id = `${id}${n}`;
    }
    used.add(id);
    return { id, label, attacks: g.attacks };
  });
}

/**
 * 两条攻击是不是**同一次开火的同一种伤害**（D-150）。
 *
 * 需求方 2026-11-12：「附肢寄生者那个是**感染鱼叉**不是毒云」——界面上「感染鱼叉」下出现两行毒素。
 * 那是 WFCD 把同一次命中的鱼叉拆成了 `Infested Harpoon` + `Infested Harpoon Contact`（各 15 毒素）。
 * 判断依据就用需求方给的判据：**一个射击模式一般只会有一个投射物命中**。
 * 同名、同伤害、同触发率的两条不可能是两种独立射击，只能是同一发的子段。
 *
 * ⚠ 只合**同名字**的：`Infested Harpoon`（15）与 `Normal Attack`（33）名字不同，
 *   前者是独立模式（鱼叉），后者是主射击，两者都留。
 */
function isSameShotDuplicate(a: WfcdAttack, b: WfcdAttack): boolean {
  const sig = (x: WfcdAttack): string =>
    JSON.stringify([
      Object.entries(x.damage ?? {})
        .filter(([, v]) => v)
        .sort(([k1], [k2]) => (k1 < k2 ? -1 : 1)),
      x.status_chance ?? null,
    ]);
  return sig(a) === sig(b);
}


/** 是否有明确的独立模式锚点（不算主攻击锚点） */
function hasSeparateModeAnchor(attacks: readonly WfcdAttack[]): boolean {
  return attacks.some((a) => matchesAny(a.name, SEPARATE_MODE) && !matchesAny(a.name, PRIMARY_ANCHORS));
}

/**
 * 攻击归组：返回 [[模式名, 攻击列表], …]
 *
 * 规则顺序：
 *   1. 有独立模式锚点 → 每个锚点各成一个模式，非锚点的子段并到"最近的前一个锚点"；
 *   2. 没有独立模式锚点 → 只有一个射击模式，所有攻击都是它的段（相加）；
 *   3. 退化情形（全无锚点，如火箭/奇点枪/多弹种）：见 `fallbackGroups`。
 */
function groupAttacks(attacks: readonly WfcdAttack[]): { name: string; attacks: WfcdAttack[] }[] {
  const groups: { name: string; attacks: WfcdAttack[] }[] = [];
  const anchors = attacks.filter((a) => matchesAny(a.name, SEPARATE_MODE) || matchesAny(a.name, PRIMARY_ANCHORS));

  if (anchors.length === 0) return fallbackGroups(attacks);

  let current: { name: string; attacks: WfcdAttack[] } | null = null;
  // 当前"弹种"组：BOMB_SWITCH 命中的那一段所开的组。同弹种的后续子段都归它，
  // 即使中间没有新的锚点。
  let currentBomb: { name: string; attacks: WfcdAttack[] } | null = null;
  // 当前「灵化」组：**灵化永远只有一个模式**（需求方 2026-11-12），
  // 所以 `Incarnon Form` / `Incarnon Form Held Damage` / `Incarnon Form Radial Attack`
  // 这些攻击统统并进同一个灵化组，作为它下面的多种「攻击方式」（变体），不各起一个模式。
  // 之前每遇到一个 `Incarnon Form*` 锚点就开一个新组，布莱顿 Prime 因此被拆成
  // incarnon / incarnon2 两个模式，是错的。
  let incarnonGroup: { name: string; attacks: WfcdAttack[] } | null = null;
  const isIncarnonName = (n: string): boolean => /^\s*Incarnon\s/i.test(n);
  // 当前「切换弹种 / 换弹方式」组：`SIDE_WEAPON`（Cube）与 `THROW_SWITCH`（换弹方式）命中时开的组。
  // 同主词的后续子段（`Cube Explosion`、`Reload From Empty Explosion` …）都归它。
  let currentSide: { name: string; attacks: WfcdAttack[] } | null = null;

  for (const a of attacks) {
    const name = String(a.name ?? '');
    // 灵化：不是新模式，是同一个灵化模式下的另一种攻击方式
    if (isIncarnonName(name)) {
      if (!incarnonGroup) {
        incarnonGroup = { name, attacks: [a] };
        groups.push(incarnonGroup);
      } else {
        incarnonGroup.attacks.push(a);
      }
      current = incarnonGroup;
      currentBomb = null;
      currentSide = null;
      continue;
    }
    const isAnchor = matchesAny(name, SEPARATE_MODE) || matchesAny(name, PRIMARY_ANCHORS);
    if (isAnchor) {
      current = { name, attacks: [a] };
      groups.push(current);
      currentBomb = null; // 新锚点打断弹种分组
      currentSide = null;
      continue;
    }
    // ── 扳机词切换（D-150）：`Semi-Auto Mode` / `Auto` / `Alt-Fire`… 各起一个**新模式** ──
    //
    // 需求方 2026-11-12：「雌鹿射击模式不对，他是三个模式，有两个当成一个段了。
    // 一个射击模式一般只会有一个投射物命中。」雌鹿的三条攻击是
    // `Burst Mode` / `Semi-Auto Mode` / `Auto`，每一条都是一个独立射击模式。
    // 锚点与扳机词先判——它们定义"模式本身"，后面的子段（`Radial Attack` / `Explosion`…）
    // 才归到当前扳机组里。
    if (matchesAny(name, TRIGGER_NAMES) || matchesAny(name, SIDE_ATTACK_NAMES) || matchesAny(name, ZOOM_ATTACK_NAMES)) {
      current = { name, attacks: [a] };
      groups.push(current);
      currentBomb = null;
      currentSide = null;
      continue;
    }
    // ── 独立弹道（D-150）：自己飞出去的投射物（鱼叉 / 长矛 / 榴弹…）各起一个模式 ──
    //
    // 需求方 2026-11-12 晚：「鱼叉也单开成一个射击模式（像信标、炮台那样）」。
    // 判据就是那句「一个射击模式一般只会有一个投射物命中」——一条投射物攻击自成一组，
    // 它后面紧跟的 `xxx Explosion` / `xxx Contact` 等子段跟着进组，其余攻击留在原模式。
    //
    // ⚠ `Radial Attack` / `Attraction Field` / `Cube (shot by player)` 这类子段名字挡掉，
    //   它们虽然也是投射物，但属于同一次开火的一部分（钩铳的命中附带、磁道炮的吸引场）。
    // ⚠ 范围伤害（AoE）不是弹道本体，不开组（`Cannon Mode Cluster Bomb Contact` 是集束炸弹的命中，
    //   它自己的 `Cluster Bomb Explosion` 跟随，但那条不是「投射物」所以不进这个分支）。
    if (
      isBallisticAim(a) &&
      !SUBPART_NAMES.test(name) &&
      !matchesAny(name, PRIMARY_ANCHORS) &&
      !matchesAny(name, SEPARATE_MODE) &&
      !SIDE_WEAPON.test(name) &&
      !THROW_SWITCH.test(name) &&
      !BOMB_SWITCH.test(name) &&
      !isAoEAttack(a)
    ) {
      current = { name, attacks: [a] };
      groups.push(current);
      currentBomb = { name, attacks: current.attacks }; // 它的 AoE / Contact 子段都跟进来
      currentSide = null;
      continue;
    }
    // ── 主词切换（需求方 2026-11-12）：方块弹 / 换弹方式 各起一个**新模式** ──
    //
    //   量子切割器：`Beam`(模式1) … `Cube (direct hit)`/`Cube Explosion`/`Cube (shot by player)`(模式2)
    //   异化者：    `Primary`(模式1) … `Partial Reload Impact`+`Explosion`(模式2) … 同上（换弹方式换一种就再起一组）
    //
    // 判据是「名字的主词」（`Cube` / `Partial Reload` / `Reload From Empty`）：
    // 主词相同 → 归当前组；主词不同 → 开新组。这样异化者会被拆成「部分换弹」与「空弹匣换弹」两种模式。
    const sideWord = name.match(SIDE_WEAPON)?.[1] ?? name.match(THROW_SWITCH)?.[1] ?? null;
    if (sideWord) {
      const sameSide = currentSide && currentSide.name.toLowerCase().startsWith(sideWord.toLowerCase());
      if (sameSide) {
        currentSide!.attacks.push(a);
      } else {
        currentSide = { name, attacks: [a] };
        groups.push(currentSide);
      }
      continue;
    }
    // ── 弹种切换：`Cluster Bombs Impact` 开新组，`Cluster Bombs Explosion` 归它 ──
    const bomb = name.match(BOMB_SWITCH)?.[1] ?? null;
    if (bomb) {
      if (currentBomb && currentBomb.name.toLowerCase().startsWith(bomb.toLowerCase())) {
        currentBomb.attacks.push(a);
      } else {
        currentBomb = { name: name, attacks: [a] };
        groups.push(currentBomb);
      }
      currentSide = null;
      continue;
    }
    // 其余子段归当前主词组，否则归当前弹种组，再否则归当前锚点
    if (currentSide) {
      currentSide.attacks.push(a);
    } else if (currentBomb) {
      currentBomb.attacks.push(a);
    } else if (current) {
      current.attacks.push(a);
    } else {
      // 锚点之前的孤立子段 → 自成一组的起点
      current = { name: name, attacks: [a] };
      groups.push(current);
    }
  }

  // ── D-150：兜底再摘一次扳机词 ──
  //
  // 上面已经让扳机词各开一组；但如果某一组**整组都没有锚点**（首条是子段、名字不像任何模式），
  // 组里又混着扳机词攻击，这里把它们各拆成独立模式。
  // 「同一次开火的附属段」（钩铳的命中附带、磁道炮的 `Attraction Field`、
  // 量子切割器的 `Cube (shot by player)`）名字不在 `TRIGGER_NAMES` 里，不受影响。
  const split: { name: string; attacks: WfcdAttack[] }[] = [];
  for (const g of groups) {
    // 该组是否已经有自己的锚点（主攻击 / 独立模式 / 扳机词）开场
    const gAnchor =
      matchesAny(g.name, PRIMARY_ANCHORS) ||
      matchesAny(g.name, SEPARATE_MODE) ||
      matchesAny(g.name, TRIGGER_NAMES) ||
      matchesAny(g.name, SIDE_ATTACK_NAMES) ||
      matchesAny(g.name, ZOOM_ATTACK_NAMES);
    const stay: WfcdAttack[] = [];
    const standalone: WfcdAttack[] = [];
    for (const a of g.attacks) {
      const n = String(a.name ?? '');
      const isAnchorName = matchesAny(n, PRIMARY_ANCHORS) || matchesAny(n, SEPARATE_MODE);
      // 组里已经有锚点打头 → 它就定义了这个模式本身，不再往外拆；
      // 只有「整组都没有锚点」时才把扳机词拆出来（否则量子切割器的 `Cube (shot by player)`
      // 这种附属段会被单拎成第三个模式）。
      const splitOut =
        !isAnchorName &&
        !gAnchor &&
        (matchesAny(n, TRIGGER_NAMES) || matchesAny(n, SIDE_ATTACK_NAMES));
      if (splitOut) standalone.push(a);
      else stay.push(a);
    }
    if (stay.length > 0) split.push({ name: g.name, attacks: stay });
    for (const a of standalone) split.push({ name: String(a.name ?? ''), attacks: [a] });
  }

  // ── D-150：同一模式内的「重复子段」去重 ──
  //
  // 附肢寄生者的「感染鱼叉」在 WFCD 里是 `Infested Harpoon` + `Infested Harpoon Contact` 两条，
  // 数值一模一样（各 15 毒素、触发 30%）。按「一个射击模式一般只会有一个投射物命中」，
  // 这是同一次开火的同一发，不能算两段——否则界面上同一种毒素会显示两行。
  for (const g of split) {
    const subpartStem = (n: string): string =>
      String(n ?? '')
        .trim()
        .toLowerCase()
        .replace(/\s+(contact|impact|explosion|explode|detonation|radial attack|aoe|direct hit)$/i, '')
        .trim();
    const kept: WfcdAttack[] = [];
    for (const a of g.attacks) {
      const dup = kept.some((k) => isSameShotDuplicate(k, a) && subpartStem(k.name) === subpartStem(a.name));
      if (!dup) kept.push(a);
    }
    g.attacks = kept;
  }
  return split;
}

/**
 * 无明确锚点时的退化分组（火箭 / 奇点枪 / 多弹种 / 六连导弹）：
 *   · 全部攻击视为一个射击模式（相加），除非包含「按名字切换」的弹种（Quill / Barrage / 1st Attack…）；
 *   · 「按名字切换」的不合并，每个名字一个模式。
 */
function fallbackGroups(attacks: readonly WfcdAttack[]): { name: string; attacks: WfcdAttack[] }[] {
  const switchable = /^(\d+(st|nd|rd|th) Attack|Barrage Mode|.*Quill|Horizontal Spread|Charge)$/i;
  const singles = attacks.filter((a) => switchable.test(a.name));
  if (singles.length > 0) {
    // 按名字切换：每个名字一个模式，其余子段（爆炸等）跟随同名家族
    const out: { name: string; attacks: WfcdAttack[] }[] = [];
    let current: { name: string; attacks: WfcdAttack[] } | null = null;
    for (const a of attacks) {
      if (switchable.test(a.name) || current === null) {
        current = { name: a.name, attacks: [a] };
        out.push(current);
      } else {
        current.attacks.push(a);
      }
    }
    return out;
  }
  return [{ name: 'default', attacks: [...attacks] }];
}

// ─────────────────────────────────────────────────────────────
// 攻击 → 伤害段
// ─────────────────────────────────────────────────────────────

function toSpread(damage: Record<string, number> | undefined, warnings: string[], context: string): DamageSpread {
  const out: DamageSpread = {};
  for (const [k, v] of Object.entries(damage ?? {})) {
    const t = DAMAGE_KEY[k.toLowerCase()];
    if (!t) {
      warnings.push(`${context}: 未知伤害类型 ${k}（已忽略）`);
      continue;
    }
    if (typeof v === 'number' && v !== 0) out[t] = (out[t] ?? 0) + v;
  }
  return out;
}

/**
 * 一个 WFCD 攻击 → 一段。
 * `shot_type === 'AoE'` → 范围段（`aoe: true`，不吃镀层）。
 * 段上**保留该攻击自己的暴击/触发/射速**（WFCD 攻击级有独立数值）。
 */
export function toSegment(a: WfcdAttack, warnings: string[], context: string): DamageSegment | null {
  const damage = toSpread(a.damage, warnings, context);
  if (Object.keys(damage).length === 0) return null;
  // `forcedAoe`：WFCD 缺 `shot_type` 但确定是范围伤害的那几条（量子切割器的玩家引爆）
  const aoe = String(a.shot_type ?? '').toLowerCase() === 'aoe' || forcedAoe(a.name);
  const isHitScan = String(a.shot_type ?? '').toLowerCase() === 'hit-scan';
  return {
    kind: aoe ? 'explosiveAttack' : 'attack',
    aoe,
    damage,
    // WFCD 的 status_chance 是**百分比**（11.25 = 11.25%）；内核是 0~1
    procChance: typeof a.status_chance === 'number' ? a.status_chance / 100 : 0,
    // 射线**按段判**（需求方 2026-11-12）：只有 Hit-Scan 的那一段是激光本体。
    // 不写的段跟随模式扳机，所以这里只在"明确不是射线"时写 `false`。
    ...(isHitScan ? {} : { beam: false }),
  };
}

/**
 * 攻击级面板 → 模式级 override（暴击/触发/射速只有和武器级**实质不同**时才写）。
 *
 * ⚠ D-148：必须用容差比较。WFCD 的武器级字段是 4 位小数，攻击级只给 2 位
 * （艾弗旺-5：武器级 `7.8333`、攻击级 `7.83`；震地枪：`9.3333` vs `9.33`），
 * 严格比较会为几乎所有武器都生成一份模式级 override。
 * 而模式级 override 在合并时优先于武器级，于是"在编辑器里改武器级面板"
 * 会被这份浮点噪声盖掉——显示保存成功、页面却不变。
 *
 * 容差取 0.011（比两位小数的舍入误差 0.005 略大，又不至于吃掉真正的差异）。
 */
const CLOSE = 0.011;
const differs = (a: number | undefined, b: number | undefined): boolean =>
  typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) > CLOSE;

function attackOverride(a: WfcdAttack, weapon: WfcdWeapon): PanelOverride | undefined {
  const o: PanelOverride = {};
  if (differs(a.crit_chance != null ? a.crit_chance / 100 : undefined, weapon.criticalChance)) {
    o.critChance = a.crit_chance! / 100;
  }
  if (differs(a.crit_mult, weapon.criticalMultiplier)) o.critMultiplier = a.crit_mult!;
  if (differs(a.status_chance != null ? a.status_chance / 100 : undefined, weapon.procChance)) {
    o.statusChance = a.status_chance! / 100;
  }
  if (differs(a.speed, weapon.fireRate)) o.fireRate = a.speed!;
  return Object.keys(o).length > 0 ? o : undefined;
}

// ─────────────────────────────────────────────────────────────
// 武器
// ─────────────────────────────────────────────────────────────

const CATEGORY: Readonly<Record<string, Weapon['category']>> = {
  LongGuns: 'primary',
  Pistols: 'secondary',
  Melee: 'melee',
  SpaceGuns: 'archgun',
  SpaceMelee: 'archmelee',
  SentinelWeapons: 'companion',
};

export function toCategory(w: WfcdWeapon): Weapon['category'] {
  return CATEGORY[w.productCategory ?? ''] ?? 'unknown';
}

/**
 * 这条 WFCD 条目是否**不该收**（D-148 换源后的收录边界）。
 *
 * 官方导出有 `productCategory` 过滤，WFCD 的字段体系不同，需要按它自己的特征判：
 *
 * | 条目 | 特征 | 处理 | 依据 |
 * |---|---|---|---|
 * | 天工造武部件（刀身 / 握柄 / 环） | `type: 'Zaw Component'`、`tags` 含 `Zaw` | **不收** | 是组件不是武器；面板随握柄/环决定（D-148 规则 9） |
 * | 抗原 / 突变原（`Infested*Antigen*` / `Infested*Mutagen*`） | id 含 `Antigen` / `Mutagen` | **不收** | 生物样本 / 组装件，不是能开火的武器（D-152，需求方 2026-11-13「那些突变原啥的都是部件不是武器」） |
 * | PvP 变体（`PvPVariantTipOne` …） | `masterable: false`、uniqueName 含 `PvP` | **不收** | 与人形 PvP 模式绑定，不进 PvE 计算 |
 * | 漂泊者手枪（Sirocco）/ 赤风 | `productCategory: 'OperatorAmps'` | **不收** | 指挥官武器，沿用既定排除 |
 * | 滑板载具（`Hoverboard*`：双桅 / 双子库娃…） | uniqueName 含 `Hoverboard` | **不收** | K 式悬浮板部件，不是武器（需求方 2026-11-13「滑板去掉」） |
 * | 新武器（Nunchasa / Aksondol / Steflos Prime / Corufell Prime） | `masterable: true` | **收** | 是正式武器，只是官方导出还没有 |
 * | 重复条目（魔典 `TnDoppelgangerGrimoire`） | 与 `TnGrimoire` 同名同类别 | **不收** | WFCD 同一件武器给两条，界面会出现两个「魔典」 |
 *
 * @returns 排除原因；保留则返回 null
 */
export function exclusionReason(w: WfcdWeapon): string | null {
  if (w.productCategory === 'OperatorAmps') return '指挥官武器（OperatorAmps）';
  const type = String(w.type ?? '');
  if (/Zaw Component/i.test(type)) return '天工造武部件';
  if ((w.tags ?? []).includes('Zaw')) return '天工造武部件';
  // D-152（需求方 2026-11-13：「那些突变原啥的都是部件不是武器」「全都清掉」）：
  // 抗原 / 突变原在 WFCD 里被标成 `productCategory: Pistols`，但它们没有任何伤害面板，
  // 是生物样本 / 组装件，不是能开火的武器。
  if (/Antigen|Mutagen/i.test(String(w.uniqueName ?? ''))) return '抗原 / 突变原（部件）';
  if (String(w.uniqueName ?? '').includes('PvP')) return 'PvP 变体';
  if (w.masterable === false) return '非可精通（PvP / 变体）';
  // K 式滑板载具：不是武器，不参与配装与伤害计算。
  if (/Hoverboard/i.test(String(w.uniqueName ?? ''))) return '滑板载具（不是武器）';
  // WFCD 把魔典记了两条（TnGrimoire / TnDoppelgangerGrimoire），保留正式的那条。
  if (DUPLICATE_WFCD_IDS.has(toWeaponId(w))) return '与正式条目重复';
  return null;
}

/** D-152：确认属于重复的 WFCD 条目（同武器多记一条），保留的是 `正式 id` 那一侧 */
export const DUPLICATE_WFCD_IDS: ReadonlySet<string> = new Set([
  // 魔典：正式 id 是 TnGrimoire；TnDoppelgangerGrimoire 是同名同面板的重复条目
  'TnDoppelgangerGrimoire',
]);

/** 武器 id：取 uniqueName 最后一段（与官方导出键一致，便于跨源对照） */
export function toWeaponId(w: WfcdWeapon): string {
  const parts = (w.uniqueName ?? '').split('/');
  return parts[parts.length - 1] ?? w.name;
}

const round4 = (v: number): number => Math.round(v * 10000) / 10000;

export interface CleanedWfcdWeapon extends Weapon {
  /** 射线模式 id 列表（判据：模式扳机 = `held`），供界面标注 */
  beamModeIds: string[];
  /** 供对照：原始武器名 */
  wfcdName: string;
  /** WFCD 的 uniqueName，用于回查官方语言包补中文名（D-148） */
  uniqueName?: string;
}

export interface WfcdCleanResult {
  weapons: CleanedWfcdWeapon[];
  stats: {
    total: number;
    kept: number;
    droppedNoAttack: number;
    /** 命中收录边界被排除的条目数（天工刀身 / PvP 变体 / 指挥官武器） */
    excluded: number;
    multiMode: number;
    beamModes: number;
    unknownTrigger: number;
  };
  warnings: string[];
}

/**
 * WFCD 武器清洗主入口。
 *
 * ⚠ 不会写任何文件；产出由调用方（临时对照脚本）决定。
 */
export function cleanWfcdWeapons(raw: readonly WfcdWeapon[]): WfcdCleanResult {
  const warnings: string[] = [];
  const weapons: CleanedWfcdWeapon[] = [];
  const stats = {
    total: 0, kept: 0, droppedNoAttack: 0, multiMode: 0, beamModes: 0, unknownTrigger: 0, excluded: 0,
  };

  for (const w of raw) {
    stats.total++;
    // 收录边界：天工刀身 / PvP 变体 / 指挥官武器 一律不收（见 exclusionReason）
    const why = exclusionReason(w);
    if (why) {
      stats.excluded++;
      continue;
    }
    const attacks = w.attacks ?? [];
    if (attacks.length === 0) {
      stats.droppedNoAttack++;
      continue;
    }
    const trigger = toTrigger(w.trigger);
    if (trigger === 'unknown') stats.unknownTrigger++;

    const grouped = groupAttacks(attacks);
    const modes: AttackMode[] = [];
    const beamModeIds: string[] = [];

    for (const [gi, g] of grouped.entries()) {
      // ── 该模式内的「攻击方式」（变体）──
      //
      // 需求方 2026-11-12：一个模式内可以有多种攻击方式（弹头命中 / 爆炸 / 射线 / 蓄力），
      // 它们在界面上**分开显示并各带复选框**，用户选哪些参与计算。
      // 所以这里按「攻击组」把 g.attacks 拆成若干个变体，而不是全塞进一个变体里。
      //
      // 判定同一攻击方式：名字去掉末尾的 Impact / Explosion / AoE 等子段词后相同，
      // 例如 `Plasma Bomb Impact` 与 `Plasma Bomb Explosion` 同属「Plasma Bomb」这一种攻击。
      const variantGroups = groupAttackVariants(g.attacks);
      const variants: ModeVariant[] = [];
      for (const vg of variantGroups) {
        const segs: DamageSegment[] = [];
        for (const a of vg.attacks) {
          const s = toSegment(a, warnings, `${w.name}#${g.name}`);
          if (s) segs.push(s);
        }
        if (segs.length === 0) continue;
        // 该攻击方式自己的扳机（D-148 + 需求方 2026-11-12）
        //
        // 同一个模式里可以有两种扳机并存——典型是赘骨（Onos）的灵化：
        // `Incarnon Form Held Damage` 是射线、`Incarnon Form Charge Attack` 是蓄力。
        // 所以这里逐条攻击方式判，判不出时返回 undefined（回退到模式扳机）。
        //
        // 判据（只看名字与 shot_type）：
        //   1. 名字含 `Held` 且不是 AoE → `held`（射线）。**名字优先**：
        //      赘骨的 `Incarnon Form Held Damage` 在 WFCD 里被记成 `Projectile`，
        //      但需求方明确它是射线，所以不能单靠 shot_type；
        //   2. 名字含 `Charge` / `Charged` → `charge`（蓄力）；
        //   3. 全部是 Hit-Scan 且武器级是 `held` → `held`（普通射线武器的命中攻击）；
        //   4. 否则 undefined（跟随模式扳机）。
        const vgName = vg.attacks.map((a) => String(a.name ?? '')).join(' ');
        const vgHasHeld = vg.attacks.some(
          (a) => isHeldAttack(a.name) && String(a.shot_type ?? '').toLowerCase() !== 'aoe',
        );
        const vgHasCharge = /\bCharge(d)?\b/i.test(vgName) && !vgHasHeld;
        const vgHasHitscan = vg.attacks.some((a) => String(a.shot_type ?? '').toLowerCase() === 'hit-scan');
        const variantTrigger: TriggerKind | undefined = vgHasHeld
          ? 'held'
          : vgHasCharge
            ? 'charge'
            : vgHasHitscan && trigger === 'held'
              ? 'held'
              : undefined;
        const vOverride = attackOverride(vg.attacks[0]!, w);
        const v: ModeVariant = {
          id: vg.id,
          label: vg.label,
          segments: segs,
          ...(variantTrigger ? { trigger: variantTrigger } : {}),
          ...(vOverride ? { override: vOverride } : {}),
          defaultSelected: true,
        };
        variants.push(v);
      }
      if (variants.length === 0) continue;

      const isIncarnon = /^\s*Incarnon\s/i.test(g.name);
      const role: ModeRole = isIncarnon
        ? 'incarnon'
        : /^(Charged Shot|Quick Shot|Uncharged Shot|Charge|Uncharged Horizontal\/Vertical Shot|Perfect Shot)$/i.test(g.name)
          ? 'charged'
          : 'normal';
      // 模式 id：灵化固定 `incarnon`（**灵化永远只有一个模式**，其下多种攻击方式都在 variants 里）；
      // 其余 primary / charged / mode2 / mode3…
      let id: string;
      if (isIncarnon) {
        id = 'incarnon';
      } else if (gi === 0) {
        id = 'primary';
      } else if (role === 'charged' && modes.every((m) => m.role !== 'charged')) {
        id = 'charged';
      } else {
        id = `mode${modes.length + 1}`;
      }

      // 灵化没有弹匣/装填概念（充能弹药不建模）；其余模式共用武器级弹匣/装填。
      const firstOverride = attackOverride(g.attacks[0]!, w);
      const roleOverride: PanelOverride | undefined =
        role === 'incarnon'
          ? { ...(firstOverride ?? {}), magazineSize: 0, reloadTime: 0 }
          : firstOverride;

      // ── 该模式的扳机（= 射线的唯一判据，D-148）──
      //
      // 扳机按**模式**算，不是整把武器共用一个：
      //   · 幻离子（Phantasma）武器级 `Held`（主模式射线），副模式 `Plasma Bomb` / `Cluster Bombs`
      //     是投射物 + 范围，不是射线 → 那些模式的扳机落成 `semi`；
      //   · 巴什穆（Basmu）武器级 `Auto`，但它有一条名为 `Held` 的攻击（次要射击）→
      //     那个模式要落成 `held`，才算射线。
      //
      // 判据全用扳机 + `shot_type`，不看武器名：
      //   1. 该模式内有「名字含 Held 且不是 AoE」的攻击 → `held`；
      //   2. 否则武器级是 `held`，该模式内确有 `Hit-Scan` 攻击，且该模式的攻击**全部**是 Hit-Scan
      //      → `held`（射线本体）；
      //   3. 否则武器级是 `held`，但该模式内没有 `Hit-Scan` 攻击（全是 Projectile / AoE）
      //      → 不是射线，落 `semi`；
      //   4. 其余保持武器级扳机。
      //
      // ⚠ 第 2 条原来的写法是「只要有 Hit-Scan 就算射线」，这在**一个模式混着射线与投射物**时会判错：
      //   量子切割器武器级 `Held`，方块弹三段（Projectile / AoE）虽不同主词但曾因顺序被并在一起。
      //   现在方块弹与换弹方式已各自成模式（见 groupAttacks 的 SIDE_WEAPON / THROW_SWITCH），
      //   但它们若与射线同组（同一把枪上没有 `Beam` 锚点的情况）仍要靠"全部 Hit-Scan"这条兜住。
      //
      // ⚠ 射线的攻击名多数是 `Normal Attack` / `Primary`，**不是** `Beam`
      //   （安培克斯 / 导热聚焦枪 / 噬菌者 / 火鸡 / 冷冻光束 都是 Normal Attack），
      //   所以不能只看名字，必须结合 `shot_type`。
      const modeHitScanCount = g.attacks.filter((a) => String(a.shot_type ?? '').toLowerCase() === 'hit-scan').length;
      const modeHasHitscan = modeHitScanCount > 0;
      const modeAllHitscan = modeHitScanCount === g.attacks.length;
      const modeHasHeldAttack = g.attacks.some(
        (a) => isHeldAttack(a.name) && String(a.shot_type ?? '').toLowerCase() !== 'aoe',
      );
      const modeTrigger: TriggerKind = modeHasHeldAttack
        ? 'held'
        : trigger === 'held' && modeHasHitscan && modeAllHitscan
          ? 'held'
          : trigger === 'held' && !modeHasHitscan
            ? 'semi'
            : trigger;
      const isBeam = modeTrigger === 'held';

      // ── 模式标签与 id（需求方 2026-11-12 / 2026-11-12 晚）──
      //
      // 拆出来的副模式**一律叫「次要射击」**，与幻离子副模式的叫法一致；
      // 原始攻击名（`Cube` / `Partial Reload` / `Reload From Empty`）写进 `_note` 供溯源。
      //
      // ⚠ D-150 修正：模式**名 = 触发它的那条攻击名**，攻击方式（变体）一律叫「直接命中 / 范围伤害」。
      //   需求方 2026-11-12：
      //   > 「信标、炮台独立成模式」
      //   > 「附肢寄生者那个是**感染鱼叉**不是毒云，毒云是托里德主要模式会带的」
      //   所以巴兹火枪 ＝ 主模式 + 「信标」模式、方位角 ＝ 主模式 + 「炮台」模式、
      //   附肢寄生者 ＝ 主模式 + 「感染鱼叉」模式；模式内的两段（15+15）才是同一次开火的子段。
      //   不能再把攻击方式名拿来当模式名（旧行为会把标在攻击方式上的「信标」当成模式标题，
      //   而模式本身没有名字）。
      const isSideGroup = SIDE_WEAPON.test(g.name) || THROW_SWITCH.test(g.name);
      const sideNote = isSideGroup ? `来源攻击：${g.attacks.map((a) => a.name).join(' / ')}` : undefined;

      /**
       * 该模式自己的展示名（`_label`），没有则不出。
       *
       * 规则：**取触发这个模式的那条攻击名**，中文化；主攻击锚点（`Normal Attack` / `Burst Mode`
       * / `Incarnon Form`…）与「换弹方式」这类名字不当作模式名（前者是默认主模式，后者用「次要射击」）。
       */
      const modeLabel = ((): string | undefined => {
        if (isSideGroup) return '次要射击';
        const first = String(g.attacks[0]?.name ?? '');
        if (!first) return undefined;
        if (matchesAny(first, PRIMARY_ANCHORS) || matchesAny(first, SEPARATE_MODE) || matchesAny(first, TRIGGER_NAMES)) {
          return undefined;
        }
        if (isIncarnon) return undefined;
        // 开镜模式：模式名直接叫「开镜」，而不是「3.5x Zoom Radial Attack」这种导出原名
        if (matchesAny(first, ZOOM_ATTACK_NAMES)) return '开镜';
        // 未知名字不硬占位：出英文原名比空串更容易被发现
        return zhOf(first) ?? first;
      })();

      const mode: AttackMode = {
        id,
        role,
        trigger: modeTrigger,
        bullets: 1,
        multishot: round4(w.multishot ?? 1),
        variants,
        ...(roleOverride ? { override: roleOverride } : {}),
        ...(modeLabel ? { _label: modeLabel } : {}),
        ...(sideNote ? { _note: sideNote } : {}),
      };
      modes.push(mode);
      if (isBeam) beamModeIds.push(id);
    }

    if (modes.length === 0) {
      stats.droppedNoAttack++;
      warnings.push(`${w.name}: 所有攻击都没有伤害，已跳过`);
      continue;
    }

    // 主模式排最前（灵化/蓄力排在后面）。
    // ⚠ 必须**稳定排序**：量子切割器 / 异化者的副模式与主模式同为 `normal`，
    //   若顺序被打乱，「模式1 = 射线」就会变成「模式1 = 次要射击」。
    const order: Record<ModeRole, number> = { normal: 0, charged: 1, incarnon: 2 };
    modes.sort((a, b) => order[a.role] - order[b.role]);

    if (modes.length > 1) stats.multiMode++;
    stats.beamModes += beamModeIds.length;
    stats.kept++;

    weapons.push({
      id: toWeaponId(w),
      name: w.name,
      category: toCategory(w),
      critChance: round4(w.criticalChance ?? 0),
      critMultiplier: round4(w.criticalMultiplier ?? 1),
      statusChance: round4(w.procChance ?? 0),
      fireRate: round4(w.fireRate ?? 0),
      ...(w.magazineSize != null ? { magazineSize: round4(w.magazineSize) } : {}),
      ...(w.reloadTime != null ? { reloadTime: round4(w.reloadTime) } : {}),
      modes,
      beamModeIds,
      wfcdName: w.name,
      ...(w.uniqueName ? { uniqueName: w.uniqueName } : {}),
    });
  }

  weapons.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { weapons, stats, warnings };
}
