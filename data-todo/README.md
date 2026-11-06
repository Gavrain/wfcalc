# 数据待补清单

> 凡是在官方导出里**拿不到**、必须人工维护的数据，都登记在这里。
> 每条格式：`[ ]` 未完成 / `[x]` 已完成。完成后在 `packages/data/src/manual/` 对应文件里落数据。

## 1. 爆炸范围与伤害衰减（你确认自己补充）

官方 `ExportWeapons.json` 只给 `explosiveAttack` 的**伤害**，不给半径、也不给距离衰减公式。
实际带"爆炸范围 + 距离衰减"的武器并不多（你判断数量少，已确认由你补充）。

需要每把武器/每个 AoE 段填写：

| 字段 | 含义 | 示例 |
|---|---|---|
| `noSelfDamage` | 是否有自体伤害豁免 | true |
| `radius` | 爆心半径（米） | 3.5 |
| `falloffStart` | 衰减起始距离（米），= radius 表示不衰减 | 0 |
| `falloffEnd` | 衰减至下限的距离（米） | 3.5 |
| `minMultiplier` | 边缘处伤害倍率（0.1 = 仅 10%） | 0.1 |
| `damageFactorAtCenter` | 爆心是否额外加成 | 1.0 |

- [ ] 待补充：`Ogris`（火箭）——半径/衰减
- [ ] 待补充：`Tonkor`
- [ ] 待补充：`Penta`
- [ ] 待补充：`Kulstar`
- [ ] 待补充：`Corinth`（次要霰弹炸）
- [ ] 待补充：`Bramma`
- [ ] 待补充：其余带 `explosiveAttack` 的武器（清洗后自动生成清单）

> 建议：等 data-build 跑出全量后，脚本自动列出所有含 `explosiveAttack` 的武器，
> 你只需在这个表里逐条填数值，避免漏武器。
>
> **✅ 已自动确定（2026-11-06，D-070）**：衰减分两种模型（爆炸：单一半径；霰弹：两段），
> 已定 99 段写进 `data-todo/aoe-falloff.auto.json`，**只用于面板展示，不参与伤害计算**。
> 口径见 `research/06-衰减模型与面板展示.md`。

## 2. 灵化（Incarnon）加成

官方导出**有**灵化形态的伤害分布（清洗后标记为 `role: 'incarnon'` 的模式），
但**没有**该形态的暴击 / 触发数值——这些与普通射击不同，必须人工补。
WFCD 只对其中 7 把给出灵化形态的面板数值，且与本地值不同——那是权威来源之争，尚未列入待填表。

已自动识别出 7 把带灵化形态的武器，需要逐把补 `override`：

| 武器 | 灵化形态伤害（已自动取得） | 需补 |
|---|---|---|
| `PrimeHuntingBow`（帕里斯 Prime） | 冲击 100 + 火焰 420 | 暴率 / 暴伤 / 触发 |
| `HuntingBow`（帕里斯） | 冲击 95 + 火焰 365 | 暴率 / 暴伤 / 触发 |
| `MK1Paris`（MK1 帕里斯） | 冲击 50 + 火焰 250 | 暴率 / 暴伤 / 触发 |
| `StalkerBow`（恐惧） | 冲击 100 + 切割 100 + 火焰 200 | 暴率 / 暴伤 / 触发 |
| `PrimeBallistica`（弹射 Prime） | 切割 830 | 暴率 / 暴伤 / 触发 |
| `RVBallistica`（邪教弹射） | 切割 734 | 暴率 / 暴伤 / 触发 |
| `AutoCrossBow`（连弩） | 切割 640 | 暴率 / 暴伤 / 触发 |
| `CrpBEPlinxWeapon`（信条·普林克斯） | 冲击 100 + 辐射 500（AoE）+ 辐射 100 | 暴率 / 暴伤 / 触发 |

- [ ] 上表 8 把武器的灵化形态暴率 / 暴伤 / 触发数值
- [ ] 等级 1~5 每次强化提供的加成与触发条件
- [ ] 灵化充能条件（爆头数等）与是否可常驻

> 说明：`PrimeBallistica` / `RVBallistica` / `AutoCrossBow` / `CrpBEPlinxWeapon`
> 的"灵化"标记**尚未经人工确认**，可能是导出结构巧合。请核对后再回填。

## 2b. 太始弓（Nataruk）

**该武器完全不在官方导出里**，只能人工维护。抓取尝试记录见
`research/02-太始弓数据获取.md`（wiki 与 WFCD 全部被拦或不可用）。

- [ ] 太始弓三个面板（未蓄力 / 蓄力 / 完全蓄力）的伤害分布
- [ ] 各形态的暴击几率、暴击倍率、触发几率
- [ ] 射速、弹匣、换装时间

> 需求方说明将手动打 Excel 表维护，格式确定后请告知，我写转换脚本。

## 3. 武器赋能（Arcane）

> **已解决（2026-11-05）**：官方 `ExportArcanes.json` 里**有**结构化逐级数值，
> 只是藏在多语言模板里。已按模板拆解，产出 `packages/data/src/generated/mods/arcanes.json`。
>
> 收录范围（需求方选定）：主要· / 次要· / 近战· / 神威· / 和平· / 残差· /
> 弓箭· / 霰弹· / 双枪· / 瀑流· / 联结· / 分形·，共 62 个，**剔除 6 个不影响武器伤害的**，最终 **56 个**。

- [x] 可装备于武器的赋能清单、每级数值、生效条件、最大叠层
- [x] 与"赋能槽位"的对应关系（主要 / 次要 / 近战 / Zaw / Kitgun，由名称前缀给出）
- [ ] 6 个 `special` 类赋能（神威·触染/流行病、主要·压缩、近战·刃影、和平·追寻者、神威·狩猎）
      产生额外攻击或伤害源，需在计算内核里单独建模

## 4. Mod 数值与乘区归属

> **已解决（2026-11-05）**：官方 `ExportUpgrades.json` 确实只有基础属性（极性、稀有度、耗点），
> 没有数值。数值改从**需求方维护的紫卡模拟器 HTML 的 `ZKMODS`** 取得，并已映射到乘区。
> 详见 `research/03-Mod数据抓取.md`，产出在 `packages/data/src/generated/mods/`。
>
> 结果：**442 个武器 Mod**（每个带 0 级~满级逐级数值）+ 56 个武器赋能 + 19 个套装；
> 111 个属性键**全部**映射到乘区；与官方导出交叉校验 442/442 匹配，与 WFCD 比对 442 条 0 不一致。

- [x] 每个 Mod 的数值（按等级 0~最大）——`mods.json` 的 `stats[].levelValues`
- [x] 每个 Mod 影响的属性 → 乘区归属（见 `docs/乘区归属表`）
- [x] 套装的联动加成 —— 19 个已产出，见下方第 4a 节
- [ ] 架势不做建模（需求方确认不关注）；61 个架势仅识别，不产出
- [x] 显赫武器的 Mod 归类 —— 近战显赫归 melee，枪械显赫归对应枪
      （`packages/data/src/manual/exalted-slots.ts`）
- [ ] **近战细类补齐**（决策记录 D-004：需求方已确认**全部列为 todo，暂不关心**）

  279 把近战里 **230 把已有细类**，剩余 **49 把无细类**，暂不处理：

  | 类别 | 数量 | 样例 | 当前状态 |
  |---|---|---|---|
  | 显赫武器 | 22 | Exalted Blade、Valkyr Talons、Iron Staff、Whipclaw、Landslide Fists | `broad=melee`，`specific=[]` |
  | 天工造武 Zaw 刀身 | 22 | Dehtat、Cyath、Balla、Kronsh、Mewan、Ooltha、Dokrahm、Sepfahn、Rabvee、Plague Kripath/Keewar | `broad=melee`，`specific=[]` |
  | 哨兵/猎犬近战 | 5 | Deconstructor (+Prime)、Batoten、Lacerten、Akaten | `unresolved=true` |

  影响：这 49 把**仍可装通用近战 Mod**（`melee` 宽类），但装不了自己的专属细类 Mod
  （如显赫圣剑刀装不了剑类 Mod）。**不会算错**，只是可选项偏少。

  补齐时需要的信息：
  - 显赫武器：按形态定细类（圣剑刀=sword、女武神爪=claws、铁棒=staff、鞭击=whip、地裂拳=fist…）
  - Zaw 刀身：11 种刀身各自的近战类型（ZK 与官方导出都不给，只能人工认定）

## 4a. 套装加成（2026-11-05 确认要收录）

> 之前误判为"游戏内没有套装"。实际 `ExportModSet.json` 的 19 条就是
> 装 2 件及以上同系列模组后生效的额外加成，产出在 `generated/mods/mod-sets.json`。

- [x] 19 个套装的逐级数值（按已装件数）
- [x] 乘区归属逐个标注（`clean-modsets.ts` 的 `SET_EFFECTS`）
- [x] **私法套装的特殊口径**：`X% 几率强化暴击` 等价为**固定加算区的绝对暴击率**，
      位置在 Mod 之后：`暴率 = (面板×(1+ΣMod%) + 固定加算值) × 额外乘区`
- [x] 角斗士：每层连击倍率 +X% 近战暴率，走暴击率乘区
- [ ] **牺牲 / Umbra 套装的具体折算倍率**（决策记录 D-002，需求方已确认列为待办）
      - 机制：提高本套 Mod 自身数值（牺牲·压迫点、牺牲·斩铁 等）
      - **为什么拿不到**：官方 `ExportModSet.json` 里 Sacrifice / Umbra 两条的 `levelStats`
        全是空对象 `{}`，只有描述文本"Enhance mods in this set."，**没有给任何数值**
      - 现有线索：ZK 的 `ZKSETS` 标了 `sacrifice` 的 `per: 25`，但来源不明、无法交叉验证
      - 当前处理：`mod-sets.json` 保留机制标注（`enhanceOwnMods`）与原始数据，
        **不参与计算**；UI 应标注"该套装数值未建模"
      - 待办：等计算内核阶段，或需求方提供实测倍率后再折算

## 4b. 武器 → 可装 Mod 的对应关系

- [x] 842 把武器里 818 把判出可装 Mod 种类（`weapon-slots.json`）
- [ ] 剩余 24 把是哨兵 / 猎犬武器（Artax、Sweeper、Deconstructor、Batoten 等），
      它们走伙伴武器自己的 Mod 池，需要单独建模

## 4c. 镀层类（A-03 / D-024）

> 规则已于 2026-11-05 确认：**镀层加量 = x% × a × y**
> （x = 每层百分比、a = 目标身上异常状态的**种类数**、y = 叠层上限）。
> 数据层的 `stats[].key === 'co'` 标识镀层类；`conditions[].maxStacks` 就是 `y`。

已核对 4 个镀层 Mod，3 个可直接驱动下拉框：

| Mod | 槽位 | x | y (maxStacks) | 状态 |
|---|---|---|---|---|
| 镀层 步枪才能 `galvanized_aptitude` | rifle | 20% | 2 | ✅ |
| 镀层 准确射手 `galvanized_shot` | pistol | 30% | 3 | ✅ |
| 镀层 通晓霰弹枪 `galvanized_savvy` | shotgun | 20% | 2 | ✅ |
| 异况超量 `condition_overload` | melee | 80% | **1（常驻生效）** | ✅ |

> 需求方 2026-11-05 确认：**异况超量常驻生效、只有 1 层**，所以它 `conditions` 为空是正常的。
> `adapter.ts` 的 `conditionOverloadMaxStacks()` 对常驻型返回 1。

- [ ] **类镀层被动的武器**（需求方 2026-11-05 指示：列入 todo，后续再维护）：
      `packages/data/src/manual/weapon-effects.ts` 仍是空表。
      按 D-000 教训不按名字猜，需逐把人工确认（武器 id + 每层百分比 + 叠层上限 + 来源）。

## 4d. 劣化槽（Exilus）判定

- [ ] 数据层**没有**官方 `EXILUS` 标记，demo 目前用"是否改变伤害"反推（D-021）。
      若能从导出补抓 `EXILUS` 兼容标签，应改为读该字段。

## 5. 中文名与本地化

**已解决**：官方导出虽然只有语言包键，但 `browse.wf` 提供 `dict.zh.json` / `dict.en.json`
语言包（中文包 36165 条），武器名命中率 **637/637 = 100%**。

流水线会自动：
1. 抓取 `dict.zh.json` / `dict.en.json`
2. 用导出里的 `name` 语言键查询显示名
3. 产出里的 `name`（英文）/ `nameZh`（中文）即为显示名

- [x] 武器中英名映射（语言包自动解析）
- [ ] Mod / 赋能的官方中文名（同样可用语言包解析，待做）
