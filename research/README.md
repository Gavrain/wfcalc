# 研究记录（数据源与抓取口径）

> **这里只放「结论」与「口径」**。一次性探查脚本一律在 `poc/archive/`，**仅为留档、不保证能跑**
> （D-104）。要重跑某个探查，先看本文件的脚本表，再按需修复路径——**不要**把它们当生产代码引用。

## 结论文档

| 文档 | 管什么 |
|---|---|
| `01-数据源可行性验证.md` | 武器面板数据从哪来 |
| `02-太始弓数据获取.md` | 单个武器的取数与换算 |
| `03-Mod数据抓取.md` | Mod 数值从哪来、等级换算口径、属性键→乘区映射 |
| `04-@wfcd-items比对.md` | 本地来源汇总，与 `@wfcd/items` 的逐项对比 |
| `05-WFCD补缺执行方案.md` | D-069 定案后怎么补 AoE 衰减与灵化面板 |
| `06-衰减模型与面板展示.md` | 爆炸 / 霰弹两种衰减模型，只做面板展示（D-070） |

## `poc/archive/`（历史探查脚本，留档）

用来确认"哪个数据源带 Mod 数值"。结论已写进 `03-Mod数据抓取.md`，
正式流程在 `packages/data-build/src/build-mods.ts`，**这里不是生产代码**。

运行前需要这些缓存（`build-mods.ts` 跑一次 dry-run 就会生成）：

```
.cache/export/weapons.json        ExportWeapons.json
.cache/export/upgrades.json       ExportUpgrades.json
.cache/export/wfcd-mods.json      WFCD Mods.json（需 WFCD_INSECURE_TLS=1）
.cache/inspect/zkmods.json        由 archive/extract-zkdata.mjs 生成
.cache/inspect/weapon-db.json     由 archive/decode-weapon-db.mjs 生成
```

`node --experimental-strip-types poc/archive/<脚本>` 运行（需要从仓库根目录）。

| 脚本 | 用途 |
|---|---|
| `list-exports.mjs` | 列出 browse.wf 公开导出里有哪些文件 |
| `extract-zkdata.mjs` | 从紫卡模拟器 HTML 抠出 ZKMODS / ZKARCS / ZKSETS |
| `profile-zkmods.mjs` | 统计 ZKMODS 的字段、槽位种类、属性键分布 |
| `show-unknown-keys.mjs` | 打印未登记属性键的上下文（模组名 + 描述），用于人工判定 |
| `decode-weapon-db.mjs` | 解码模拟器里的 WEAPON_DB（字典压缩），看武器类细分 |
| `match-zk-weapons.mjs` | ZK 武器库与官方导出的匹配率（当前 637/642） |
| `crosscheck-sources.mjs` | ExportArcanes / ExportModSet 是否有数值；ZK 与官方升级表覆盖 |
| `probe-arcanes-modsets.mjs` | 看赋能与套装在官方导出里的结构 |
| `spotcheck-values.mjs` | **数值抽查**：用已知模组核对满级值/逐级值/乘区归属 |
| `list-weapon-arcanes.mjs` | 列出收录范围内的全部武器赋能及其满级描述 |
| `verify-mod-output.mjs` | 检查 Mod 产出形状与质量（无 NaN、无缺中文名等） |
| `verify-arcane-output.mjs` | 检查赋能/套装产出形状与质量 |
| `verify-slots-output.mjs` | 检查武器 → Mod 槽位判定的分布与样例 |
| `inspect.js` / `inspect/one.js` | 早期单文件探查（浏览 ZKMODS 结构） |
