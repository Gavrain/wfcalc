# 数据层说明

## 目录

```
src/generated/weapons/     流水线生成，勿手改
  primary.json             主武器
  secondary.json           副武器
  melee.json               近战（含战甲技能武器）
  archgun.json             空战枪械
  archmelee.json           空战近战
  companion.json           同伴武器
  index.json               分类统计与索引
src/generated/mods/        流水线生成，勿手改
  mods.json                442 个武器 Mod（逐级数值 + 乘区 + 条件 + 互斥）
  arcanes.json             56 个武器赋能（逐级数值 + 乘区 + 完整描述）
  mod-sets.json            19 个套装（逐级数值 + 乘区归属）
  weapon-slots.json        842 把武器 → 可装 Mod 种类
  index.json               来源、覆盖度、待办清单
src/manual/                人工维护层，改这里
  overrides.ts             修正导出错误或缺失的数值
  weapon-effects.ts        武器被动效果表
  exalted-slots.ts         显赫武器的 Mod 归类（近战归 melee、枪械归对应枪）
src/snapshot/manifest.json 上游快照的 sha256（原始 HTML 不入库）
```

## 字段口径

| 字段 | 含义 | 单位 |
|---|---|---|
| `id` | **内部名，作为主键** | 如 `RocketLauncher`、`HeavyRifle` |
| `name` | 英文显示名 | 如 `Ogris` |
| `nameZh` | 中文显示名 | 如 `食人女魔` |
| `critChance` | 暴击几率 | **0~1 小数**（0.45 = 45%） |
| `critMultiplier` | 暴击倍率 | 倍数（2 = 2 倍） |
| `statusChance` | 触发几率 | 0~1 小数 |
| `fireRate` | 射速 / 攻击速度 | 发每秒（近战为攻速，同一字段） |
| `magazineSize` / `reloadTime` | 弹匣容量 / 换弹时间 | 发 / 秒 |
| `segments[].damage` | 该段伤害分布 | 绝对值 |
| `segments[].procChance` | 该段触发几率 | 0~1 小数 |
| `segments[].aoe` | 是否范围伤害 | 布尔 |

## 多攻击模式

`modes[]` 每项是一个攻击模式：

| `role` | 含义 |
|---|---|
| `normal` | 普通射击（含"只能蓄满发射"的武器） |
| `charged` | 蓄力射击，数值与普通不同时才单独存在 |
| `incarnon` | 灵化模式，暴击/触发需人工补 `override` |

`trigger` 对应官方导出的触发方式（`auto` / `semi` / `burst` / `charge` / `held` / `active`）。

## 玄骸武器

带 `kuva` 字段的武器需要用户在计算器里选择元素与加成：

```json
"kuva": { "bonusRange": [0.25, 0.6], "elements": ["impact", "puncture", "slash", "heat", "cold", "electric", "toxin"] }
```

加成范围固定为 25%~60%，具体数值由用户在计算器里输入，数据层不预设。

## Mod 数据

来源与口径详见 `research/03-Mod数据抓取.md`。要点：

| 字段 | 含义 |
|---|---|
| `slotKind` | Mod 能装到哪类武器（`rifle` / `shotgun` / `pistol` / `melee` / `nikana`…）。**近战分两层**：`melee` 是通用近战，细类（`sword`/`nikana`…）只对应同类武器 |
| `maxRank` | 等级上限（0 = 无等级，`levelValues` 只有 1 个值） |
| `stats[].levelValues` | **0 级到满级的逐级数值**，计算内核直接用，不要再按等级推算 |
| `stats[].bucket` | 落在哪个乘区（对应 `docs/乘区归属表.md`） |
| `stats[].kind` | `normal` 常驻 / `conditional` 有触发条件 / `functional` 手感 / `special` 武器专属 / `skip` 不参与 |
| `conditions[]` | 触发条件与叠层（如击杀叠 5 层、持续 20 秒） |
| `exclusiveGroup` / `conflictsWith` | 同族互斥，一个槽位只能装一个 |

近战的可装判定（详见 `docs/decisions.md` D-001）：

```
武器 side : weapon-slots.json → { broad: "melee", specific: ["sword"] }
Mod  side : mods.json → slotKind

通用近战 Mod（slotKind = "melee"）  → 任何近战都合法
细类 Mod（slotKind = "nikana"）     → 只有 specific 含 "nikana" 的近战合法
```

代码里用 `canEquipMod(slots, modSlotKind)` 判断，不要自己拼逻辑。

数值口径：`levelValues[r] = 满级值 × r / 等级上限`，满级值取 ZKMODS 的 `p[][1]`。

## 武器赋能

来源：官方 `ExportArcanes.json`（**有结构化逐级数值**，与 Mod 不同）。详见 `research/03` 第 7 节。

| 字段 | 含义 |
|---|---|
| `category` | `primary` / `secondary` / `melee` / `kitgun`（按名称前缀） |
| `levels[].values` | 各级的数值槽（`路径 → 数值`）。**`路径#x` 表示乘法型**（如 `x8`），别当百分比用 |
| `effectKind` | `damageBuff` / `crit` / `multishot` / `status` / `elemental` / `combo` / `special` / `utility` |
| `bucket` | 落在哪个乘区；null = 不进伤害汇总（如乘法型、连击、特殊机制） |
| `description` | 满级的中英文完整描述（模板已渲染） |

收录 56 个，剔除 6 个不影响武器伤害的（近战·坚壁、神威·勇武、神威·力量、和平·电充/电闪/高飞），
剔除清单在 `arcanes.json` 的 `skipped` 字段里，带理由。

## 套装加成

来源：官方 `ExportModSet.json`。装 **2 件及以上**同系列模组生效，`levels[0]` = 装 2 件。

| 套装 | 作用 | 乘区 |
|---|---|---|
| **私法 Vigilante** | X% 几率强化主武器暴击 | **critChance（固定加算区）** |
| 角斗士 Gladiator | 每层连击倍率 +X% 近战暴率 | critChance |
| 牺牲 Sacrifice / Umbra | 增强本套 Mod 自身数值 | **未建模**（见 data-todo，D-002） |
| Nira | 震地攻击伤害 | baseDamage |
| 其余 14 个 | 同伴/生存/控制/区域伤害 | 不进伤害汇总 |

私法口径（需求方实测）：等价于**增加绝对值的暴击率**，位置在 Mod 之后：

```
暴率 = (面板暴率 × (1 + Σ暴率Mod%) + 固定加算值) × 额外乘区
                                        ↑ 私法放这里
```

## 修改数据的方式

**不要直接改 `src/generated/` 下的文件**——下次运行流水线会被覆盖。

要修正某个数值，改 `src/manual/overrides.ts`：

```ts
export const WEAPON_OVERRIDES = {
  Railgun: { chargeTime: 0.5, note: '导出射速为 0，按蓄力反推' },
  // 新增一条即可
};
```

然后重新生成：

```bash
node --experimental-strip-types packages/data-build/src/index.ts --emit
```

被人工改过的字段会在产出里留下 `_manual` 标记，记录原值、新值与理由。
