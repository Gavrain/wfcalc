# Mod 数据抓取与清洗（2026-11-05）

> 结论先行：**武器 Mod 的数值已经全部拿到**——442 个武器 Mod、61 个架势、37 个武器赋能，
> 每个 Mod 都带 0 级到满级的逐级数值，并已映射到 `docs/乘区归属表.md` 的乘区。
>
> 关键判断：**官方导出 `ExportUpgrades.json` 没有数值**（只有极性/稀有度/耗点，
> 实测 1604 条全是元数据）。数值实际来自需求方维护的紫卡模拟器 HTML 里的 `ZKMODS`，
> 再用官方导出与 WFCD 做交叉校验。

## 1. 数据源实测

| 数据源 | 有数值？ | 结论 |
|---|---|---|
| `browse.wf/.../ExportUpgrades.json` | **否** | 只有 `polarity` / `rarity` / `baseDrain` / `fusionLimit` / `compat`。用来做**交叉校验**（按英文名匹配 442/442 = 100%） |
| 紫卡模拟器 HTML 的 `ZKMODS` | **是** | 543 条：442 武器 Mod + 61 架势 + 37 赋能。每条带 `p`（满级值）、`f`（等级上限）、`i/n/z`（id/英/中） |
| `WFCD/warframe-items` 的 `Mods.json` | **文本级** | 1809 条，但等级数值是英文展示串（`"+10% Damage"`），要解析 1003 种文本形态。只当交叉校验用（等级上限比对 442 条全部一致）。**MIT 许可** |
| `ExportArcanes.json` / `ExportModSet.json` | **是**（结构化） | 武器赋能与套装加成在官方导出里**有**逐级数值，后续可直接用于赋能层 |
| `ExportWeapons.json` 的 `holsterCategory` / `compatibilityTags` | 不适用 | 用来判定"某把武器能装哪类 Mod" |

GitHub 在本机被 TLS 拦截（`UNABLE_TO_VERIFY_LEAF_SIGNATURE`，抓包为 `sni-static.lv2.pw`），
WFCD 需要 `WFCD_INSECURE_TLS=1` 才能直连；已有缓存时不影响主流程。

## 2. ZKMODS 的字段与数值口径（实测反推，已交叉验证）

```js
{ i:"serration", n:"Serration", z:"膛线", t:"rifle", s:"g",
  d:4, f:10, r:"c", y:"r", p:[["dmg",165]], de:"+X% Damage" }
```

| 字段 | 含义 | 口径 |
|---|---|---|
| `i` / `n` / `z` | id / 英文名 / 中文名 | 中文名 442/442 齐全 |
| `t` | Mod 槽位种类 | `rifle` / `shotgun` / `pistol` / `melee` / `bow` / `sniper` / `nikana` / `glaive` … 共 38 种 |
| `s` | 粗分类 | `g` 枪械 / `m` 近战 / `a` 赋能 / `p` ——**不可靠**，见下方"踩过的坑" |
| `d` | 0 级耗点 | 与官方 `baseDrain` 一致 |
| `f` | **等级上限** | 0~10 |
| `p` | `[属性键, 满级值]` 或 `[属性键, 满级值, 每级加量]` | **`p[][1]` 是满级值** |
| `fam` / `inc` | 同族（互斥，只能装一个） / 与之互斥的其它 Mod | 165 个 Mod 有互斥族 |
| `bg` | 触发条件 / 叠层 | 49 个 Mod 带条件效果 |

**逐级换算（实测多个模组交叉验证一致）：**

```
第 r 级值 = 满级值 × r / 等级上限          // 0 级为 0，满级为 p[][1]
若 p 带第三项：第 r 级值 = 每级加量 × r     // 覆盖上面的线性推算
f = 0：没有等级，只有一个数值
```

已验证样例：Serration 满级 165%（每级 16.5）、Point Strike 150%（每级 30）、
Hornet Strike 220%（每级 22）、Point Blank 90%（每级 18）、Galvanized Steel 每级 30% 满级 300%。

## 3. 踩过的坑（都已修，记录以免重犯）

1. **架势混在武器 Mod 里**：`s` 字段区分不出架势——68 个架势里大多标成 `m`，少数标成 `p`；
   而 `p` 里又混着真正的普通 Mod（如并合锐卡斯斩铁）。若按 `s` 过滤，架势会被当成"0 级数值的 Mod"。
   → 改用"官方 `type === 'STANCE'`" + "`p` 为空且描述无 `+X`"判定。
2. **`f = 1` 的歧义**：17 个 Mod 写了 `f=1`，但它们的数值实际是"每级加量"
   （Amanata Pressure 每级 +55%、满级 +330%）。已按 WFCD 的等级数逐个修正（11 条）。
3. **官方同名条目**：官方导出里 `Primed Pressure Point` 的语言键显示名曾经就是 `Pressure Point`，
   简单按英文名取"最高等级的一条"会张冠李戴。→ 改为按"稀有度 + 耗点 + 等级上限"打分挑最像的。
4. **WFCD 自身的数据问题**：WFCD 里 `WeaponMeleeDamageOnHeavyKillMod` 的 `name` 也是 `Pressure Point`
   （等级上限 10，实际是另一把 Mod）。→ 交叉校验改为"同名唯一才硬校验，同名多条只要有一条对上即可"。
5. **手枪缺 `holsterCategory`**：官方导出里 263/328 把手枪没有这个字段，
   霰弹类手枪（Bronco / Pyrana）更是无法从导出区分。→ 槽位判定以 **ZK 武器库的 `c` 字段**为主。
6. **哨兵枪械有 RIFLE / SNIPER 的 holster 值**：必须在 holster 判定**之前**拦掉，
   否则哨兵武器会被当成可配装主武器。

## 4. 武器 → 可装 Mod 槽位

判定优先级（逐级回退，产出里记录 `source` 便于排查）：

1. **ZK 武器库的 `c`（武器类）** —— 主判据，646 把武器命中
2. **官方 `holsterCategory`** —— 5 把
3. **近战 `*_STANCE` 标签** —— 补细类
4. **产品大类** —— 163 把
5. **人工表 `packages/data/src/manual/exalted-slots.ts`** —— 显赫武器

结果：842 把武器里 **818 把**判出可装 Mod 种类，
剩余 24 把全部是**哨兵 / 猎犬武器**（Artax、Sweeper、Deconstructor、Batoten…），
它们走伙伴武器自己的 Mod 池，不在本项目"武器配装"范围内，因此标为待确认而非丢弃。

可装关系（`compatibleModKinds`）：

| 武器类 | 可装 Mod 种类 |
|---|---|
| rifle（含发射器/弩） | rifle + primary |
| bow / sniper | bow/sniper + rifle + primary |
| shotgun | shotgun + primary |
| pistol（含霰弹手枪） | pistol |
| melee | melee + 对应细类（sword / nikana / glaive …） |
| 显赫武器 | 按人工表标定的细类（圣剑刀=sword，女武神爪=claws） |

## 5. 属性键 → 乘区映射

ZKMODS 用到 **109 个属性键，全部已登记**（`packages/data-build/src/mods/stat-map.ts`），
分 5 类 kind。按 442 个 Mod 展开成 **567 条属性加量**，分布：

| kind | 属性条数 | 含义 |
|---|---|---|
| `normal` | 319 | 稳定的面板加量，直接进乘区（dmg / ms / cc / cd / sc / 元素 / 物理 / fac / sd） |
| `functional` | 139 | 影响手感不进伤害汇总（换弹、弹匣、变焦、后坐、Punch Through…） |
| `special` | 67 | 武器专属机制（集团特效、Tennokai、灵化、击杀爆炸…） |
| `conditional` | 28 | 有触发条件或叠层（co 镀层类、weak 弱点、br 急进猛突、firstShot…） |
| `skip` | 14 | 明确不参与伤害计算 |

最易错配的几条（已在表里写死并加测试）：

- `sd` = **异常状态伤害 +X%**，不是状态持续时间（`statusDur` 才是）
- `ps` = **弹速 / 光束射程**，不是触发几率
- `co` = 镀层/条件过载「每个异常状态 +X% 伤害」，**不吃灵化基伤与 AoE**（第 2.1 节）
- `weak` = 对弱点伤害，按第 3.2 节**爆头倍率**结算，不是派系加成的兄弟

## 6. 产出

```
packages/data/src/generated/mods/
  mods.json          442 个武器 Mod（含逐级数值、乘区、条件、互斥）
  arcanes.json       56 个武器赋能（含逐级数值、乘区、完整描述）
  mod-sets.json      19 个套装（含逐级数值、乘区归属）
  weapon-slots.json  842 把武器 → 可装 Mod 种类
  index.json         来源、覆盖度、待办清单
packages/data/src/generated/reports/mods-latest.md   统计与异常清单
packages/data/src/snapshot/manifest.json             上游快照的 sha256（原始文件不入库）
```

跑法：

```bash
node --experimental-strip-types packages/data-build/src/build-mods.ts           # dry-run
node --experimental-strip-types packages/data-build/src/build-mods.ts --emit    # 写入
```

## 7. 赋能（2026-11-05 需求方确认范围后补齐）

与 Mod 不同：**赋能在官方导出里是有结构化数值的**（`ExportArcanes.json`），
只是数值藏在多语言模板里，需要按模板拆：

```json
{ "tag": "/Lotus/Language/Arcanes/PrimaryDamageOnKillDesc",
  "sub": { "CONDITION": "...", "BONUS": { "tag": "...WeaponDamageModDesc",
           "sub": { "val": "+30" } }, "DURATION": "6" } }
```

处理方式：
1. 用语言包把模板渲染成可读中英文描述（占位符 `|BONUS|` / `|val|` 会被替换）
2. 递归收集 `sub` 里**所有数值槽**成 `{ 路径: 数值 }`，逐级对比得到 `levels`
3. **乘法型数值**（`x8`）单独记成 `路径#x`，不与百分比混在一起

**收录范围**（需求方选定）：主要· / 次要· / 近战· / 神威· / 和平· / 残差· /
弓箭· / 霰弹· / 双枪· / 瀑流· / 联结· / 分形·，共 **62 个**。

**剔除 6 个**（不影响武器伤害，逐个人工核对，不是关键字猜的）：

| 赋能 | 剔除理由 |
|---|---|
| 近战·坚壁 | 近战击杀 +210 护甲，只加护甲 |
| 神威·勇武 | 重击击杀回能量，属战甲能量层 |
| 神威·力量 | 处决击杀生命窃取，只回血 |
| 和平·电充 | 电池充电延迟，只影响弹药循环 |
| 和平·电闪 | 给下一个技能加技能效率/强度，属战甲层 |
| 和平·高飞 | 只影响精准度/后坐力/飞身瞄准时长 |

> 注意：**近战·苦痛**（Melee Afflictions）曾被误认为"加护甲"，实际是
> **击倒敌人时复制异常状态层数**，直接提升 DoT，已收录。

**最终 56 个**，按作用分类：

| 作用 | 数量 | 进哪个乘区 |
|---|---|---|
| damageBuff | 15 | baseDamage（其中乘法型 xN 的 bucket 为 null，需单独处理） |
| status | 13 | statusChance / 异常状态 |
| crit | 7 | critChance / critMultiplier |
| special | 6 | 待人工确认（产生投射物、复制攻击等） |
| elemental | 5 | elemental |
| multishot | 5 | multishot |
| combo | 3 | 连击类，不进命中伤害 |
| utility | 2 | 手感类 |

## 8. 套装（2026-11-05 需求方确认要收录）

> 之前我误判为"游戏内没有套装"，实际 `ExportModSet.json` 的 19 条就是
> 装 2 件及以上同系列模组后生效的额外加成，语言包原文是"增强这个组合中的 MOD"。

产物 `mod-sets.json`，逐级数值按**已装件数**索引（`levels[0]` = 装 2 件）。

**乘区归属**（逐个人工标注，`SET_EFFECTS`）：

| 套装 | 作用 | 乘区 |
|---|---|---|
| **私法 Vigilante** | X% 几率强化主武器暴击 | **critChance（固定加算区）** |
| **角斗士 Gladiator** | 每层连击倍率 +X% 近战暴率 | critChance |
| 牺牲 Sacrifice / Umbra | 增强本套 Mod 自身数值 | 无（放大本体效果） |
| Nira | 震地攻击伤害 | baseDamage |
| 其余 14 个 | 同伴/生存/控制/区域伤害 | 不进伤害汇总 |

**私法的计算口径**（需求方实测）：`X% 几率强化暴击` 等价于**增加绝对值的暴击率**，
且作用位置在 **Mod 之后**，属于乘区归属表 2.0 节的「固定加算值」：

```
暴率 = (面板暴率 × (1 + Σ暴率Mod%) + 固定加算值) × 额外乘区
                                        ↑ 私法套装放这里
```

## 9. 近战与显赫武器（2026-11-05 修订：近战要区分类型）

> 修订记录见 `docs/decisions.md` D-001：上一轮曾把近战全部合并为 `melee`，
> 需求方纠正"近战专属 Mod 不能用于所有近战武器"，现已恢复细类。

- **近战分两层判断**：
  - **宽类 `melee` 的通用 Mod**（压迫点、急进猛突…）→ 对任何近战合法
  - **细类 Mod**（尼卡纳系、关刀系…）→ 只对同名细类合法
  - 判定函数：`canEquipMod(slots, modSlotKind)`
- 细类来源优先级：
  1. ZK 武器库的 `c` 字段（`sword` / `nikana` / `hammer` / `glaive` …，26 种）
  2. 官方导出的 `*_STANCE` 标签（ZK 只给宽类时补细类）
- **显赫武器**：近战类的归 `melee`，枪械类的归对应的枪（Dex Pixia → pistol）。
  人工表见 `packages/data/src/manual/exalted-slots.ts`。
- 结果：279 把近战里 **230 把判出细类**，剩余 49 把见 D-004（显赫 22 / Zaw 22 / 哨兵 5，待确认）。
- 架势本身**不建模**（需求方确认不关注），只用来辅助判定细类。

## 10. 仍未覆盖、需要人工或后续处理的

- [ ] **架势不做建模**（需求方确认不关注）；61 个架势仅识别出来，不产出
- [ ] **6 个 special 类赋能的乘区**：神威·触染/流行病、主要·压缩、近战·刃影、和平·追寻者、神威·狩猎，
      它们产生额外攻击或伤害源，需要在计算内核里单独建模
- [ ] **`ZKMODS` 缺失的 Mod**：ZK 表只有 442 个武器 Mod，官方导出里共有 341 个 PRIMARY + 175 SECONDARY +
      203 MELEE Mod 条目（含重复文件路径）。缺的那些需要另外找数值来源。
- [ ] **紫卡（Riven）词条数值**：`ZKDATA` 里有基准值表，本次未处理。
- [ ] **紫卡（Riven）词条数值**：`ZKDATA` 里有基准值表，本次未处理。
