# `trigger` 未知武器清单（A-13，待需求方逐把判定）

> 数据来源：`packages/data/src/generated/weapons/*.json`（2026-11-05 生成，637 把武器）。
> `trigger` 来自官方导出每个 behaviour 的 `stateName`；**导出里没给 `stateName` 的，清洗后一律落成 `unknown`**。
> 本文只列**需要判定**的部分；近战与空战近战的 `unknown` 是结构上正常的（近战没有"射击触发方式"），不列入。

## 1. 现有 6 种 trigger 取值

`auto` 自动 / `semi` 半自动 / `burst` 点射 / `charge` 蓄力 / `held` 持续（**实测 0 命中**）/ `active` 激化(?) / `unknown`

`active` 共 12 个模式（主 6 / 副 5 / 重枪 1），目前按"未知的特殊射击"处理，**也请一并确认它指什么**。

## 2. 各分类的 `unknown` 分布

单位：攻击模式数（一把武器可能有多个模式）。

| trigger | 主武器 | 副武器 | 近战 | 重枪 | 空战近战 | 同伴 | 合计 |
|---|---|---|---|---|---|---|---|
| auto | 98 | 74 | 7 | 9 | 0 | 7 | 195 |
| semi | 90 | 68 | 2 | 2 | 0 | 2 | 164 |
| charge | 65 | 23 | 0 | 11 | 0 | 1 | 100 |
| burst | 27 | 21 | 0 | 1 | 0 | 5 | 54 |
| active | 6 | 5 | 0 | 1 | 0 | 0 | 12 |
| **unknown** | **25** | **22** | **272** | **4** | **11** | **4** | **338** |

- 近战 272 + 空战近战 11 = **283 个 `unknown` 模式**：近战没有射击触发方式，**不需要逐个填**。
- 剩下的 **55 个 `unknown` 模式**（主 25 / 副 22 / 重枪 4 / 同伴 4）需要你判定。

## 3. 需要判定的 55 个模式

两张表用同一个标注方式：请在「判定」列填 **射线 / 普通 / 其它（说明）**。

> ⚠ 第一张表只是我**按名字关键词**做的初步聚堆，**不是结论**（按名字猜正是 D-000 第 3 条教训）。
> 比如 `Panthera` 是锯片枪、`Phantasma` 是霰弹、`Basmu` 是电弧——它们可能都不是射线，需你判断。

### A. 疑似射线 / 持续型（按名字聚堆，仅供参考）

| 武器（英文 / 中文） | id | 模式 | 暴率 | 触发 | 射速 | 多重 | 判定 |
|---|---|---|---|---|---|---|---|
| Coda Synapse / 终幕·突触生化枪 | `CodaSynapse` | primary | 40% | 15% | 12 | 1 |  |
| Tenet Glaxion / 信条·冷冻光束步枪 | `CrpBEGlaxion` | primary | 20% | 40% | 12 | 1 |  |
| Tenet Quanta / 信条·量子切割器 | `CrpBEQuanta` | primary | 31% | 26% | 10 | 2 |  |
| Phantasma Prime / 幻离子 Prime | `PhantasmaPrimeShotgun` | primary | 11% | 22% | 12 | 6 |  |
| Panthera Prime / 猎豹 Prime | `PrimePanthera` | mode2 | 18% | 30% | 3.67 | 1 |  |
| Quanta Vandal / 量子切割器·破坏者 | `QuantaVandal` | primary | 22% | 45% | 12 | 2 |  |
| Panthera / 猎豹 | `TnoMiter` | mode2 | 12% | 24% | 3 | 1 |  |
| Synoid Gammacor / 枢议·咖玛腕甲枪 | `CSSynoidGammacor` | primary | 20% | 28% | 12 | 1 |  |
| Synoid Gammacor / 枢议·咖玛腕甲枪 | `CSSynoidGammacor` | mode2 | 20% | 28% | 12 | 1 |  |
| Coda Catabolyst / 终幕·异化者 | `CodaCatabolyst` | primary | 11% | 50% | 12 | 1 |  |
| Tenet Cycron / 信条·循环离子枪 | `CrpBECycron` | primary | 20% | 40% | 12 | 1 |  |
| Kuva Nukor / 赤毒·努寇微波枪 | `KuvaNukor` | primary | 7% | 50% | 10 | 1 |  |
| Larkspur Prime / 翠雀 Prime | `PrimeLarkspurWeapon` | primary | 14% | 50% | 12 | 1 |  |

### B. 其余（看起来像普通武器，但导出里同样没有触发方式）

| 武器（英文 / 中文） | id | 模式 | 暴率 | 触发 | 射速 | 多重 | 判定 |
|---|---|---|---|---|---|---|---|
| Torid / 托里德 | `BioWeapon` | mode2 | 15% | 23% | 1.5 | 1 |  |
| Amprex / 安培克斯 | `ChainLightningRifle` | primary | 32% | 22% | 12 | 1 |  |
| Glaxion / 冷冻光束步枪 | `CrpFreezeRayRifle` | primary | 8% | 34% | 12 | 1 |  |
| Glaxion Vandal / 冷冻光束步枪·破坏者 | `CrpFreezeRayVandalRifle` | primary | 14% | 38% | 12 | 1 |  |
| Flux Rifle / 通量步枪 | `CrpLaserRifle` | primary | 10% | 24% | 12 | 1 |  |
| Battacor / 武使之力 | `CrpSentExperimentRifle` | primary | 32% | 18% | 3.57 | 1 |  |
| Quanta / 量子切割器 | `CrpShockRifle` | primary | 16% | 24% | 12 | 2 |  |
| Convectrix / 导热聚焦枪 | `CrpSplitLaser` | primary | 16% | 45% | 12 | 2 |  |
| Convectrix / 导热聚焦枪 | `CrpSplitLaser` | mode2 | 16% | 45% | 12 | 2 |  |
| Ignis / 伊格尼斯 | `FlameThrower` | primary | 11% | 27% | 8 | 1 |  |
| Ignis Wraith / 伊格尼斯·亡魂 | `FlameThrowerWraith` | primary | 17% | 29% | 8 | 1 |  |
| Boar / 野猪 | `FullAutoShotgun` | mode2 | 10% | 8% | 4.17 | 8 |  |
| Synapse / 突触生化枪 | `InfestedRifle` | primary | 39% | 13% | 12 | 1 |  |
| Phage / 噬菌者 | `InfestedShotgun` | primary | 19% | 16% | 12 | 7 |  |
| Boar Prime / 野猪 Prime | `PrimeBoar` | mode2 | 15% | 11% | 4.67 | 8 |  |
| Phantasma / 幻离子 | `RevenantShotgun` | primary | 3% | 22% | 12 | 6 |  |
| Basmu / 巴什穆 | `SentRifleNewWarGun` | mode2 | 15% | 29% | 12 | 1 |  |
| Enkaus / 绘墨 | `TnInkRifleWeapon` | primary | 16% | 32% | 12 | 1 |  |
| Furis / 盗贼 | `AutoPistol` | mode2 | 5% | 12% | 10 | 1 |  |
| Gammacor / 咖玛腕甲枪 | `CSDroidArray` | primary | 8% | 20% | 12 | 1 |  |
| Gammacor / 咖玛腕甲枪 | `CSDroidArray` | mode2 | 8% | 20% | 12 | 1 |  |
| Cycron / 循环离子枪 | `CrpChargeGun` | primary | 12% | 30% | 12 | 1 |  |
| Spectra / 光谱切割器 | `CrpLaserPistol` | primary | 14% | 22% | 12 | 1 |  |
| Spectra Vandal / 光谱切割器·破坏者 | `CrpLaserPistolVandal` | primary | 20% | 28% | 12 | 1 |  |
| Ocucor / 视使之触 | `CrpSentExperimentPistol` | primary | 16% | 24% | 12 | 1 |  |
| Onos / 赘骨 | `EntratiWristGunWeapon` | mode2 | 26% | 22% | 1.4 | 1 |  |
| Onos / 赘骨 | `EntratiWristGunWeapon` | mode3 | 26% | 22% | 1.4 | 1 |  |
| Atomos / 原子矿融炮 | `GrnHeatGun` | primary | 15% | 21% | 8 | 1 |  |
| Nukor / 努寇微波枪 | `GrnMicrowavePistol` | primary | 3% | 29% | 10 | 1 |  |
| Catabolyst / 异化者 | `InfBeamPistol` | primary | 11% | 43% | 12 | 1 |  |
| Embolist / 安柏勒斯 | `InfestedPistol` | primary | 3% | 41% | 8 | 1 |  |
| MK1-Furis / MK1-盗贼 | `MK1Furis` | mode2 | 5% | 1% | 8.33 | 1 |  |
| Athodai Prime / 阿索代 Prime | `PrimeAthodaiPistolWeapon` | mode2 | 40% | 10% | 5 | 1 |  |
| Sepulcrum / 追击者 | `ThanotechPistol` | mode2 | 30% | 14% | 3.67 | 1 |  |
| Athodai / 阿索代 | `TnJetTurbinePistolWeapon` | mode2 | 32% | 8% | 5 | 1 |  |
| Cortege / 送葬者 | `ThanoTechArchGun` | primary | 20% | 40% | 12 | 1 |  |
| Morgha / 置灵者 | `ThanoTechGrenadeLauncher` | primary | 30% | 28% | 6 | 1 |  |
| Larkspur / 翠雀 | `TnShieldFrameArchGun` | primary | 10% | 50% | 12 | 1 |  |
| Artax / 阿塔克斯 | `Gremlin` | primary | 2% | 35% | 16.67 | 1 |  |
| Verglas Prime / 冰凇 Prime | `SentinelFreezeRayPrimeRifle` | primary | 14% | 36% | 12 | 1 |  |
| Verglas / 冰凇 | `SentinelFreezeRayRifle` | primary | 8% | 34% | 12 | 1 |  |
| Tazicor / 泰瑟步枪 | `TazronWeapon` | primary | 5% | 25% | 12 | 1 |  |

> 说明：同伴武器（Artax / Verglas / Tazicor）按 `data-todo` 第 4b 节的口径属于"伙伴武器自己的 Mod 池"，
> 如果这 4 个不打算现在处理，可以直接说"同伴跳过"。

## 4. 判定后的落地方式（D-010）

1. 判为**射线**的写进 `packages/data/src/manual/beam-weapons.ts`（每条带 `_manual` 与来源说明）；
2. 判为**普通**的写进同一张表并标 `beam: false`，同时**写清依据**，避免以后有人按名字又改回去；
3. 触发方式（auto / semi / burst / charge）若你知道，也请一并给出，我写进人工层覆盖 `trigger`；
4. 未判定的保持"按非射线算 + UI 标注未核实"（D-010 已确认的处理方式）。
