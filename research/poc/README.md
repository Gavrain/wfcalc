# Mod 数据来源探查脚本（research/poc）

一次性验证脚本，用来确认"哪个数据源带 Mod 数值"。结论已写进 `research/03-Mod数据抓取.md`，
正式流程在 `packages/data-build/src/build-mods.ts`，**这里不是生产代码**。

运行前需要这些缓存（`build-mods.ts` 跑一次 dry-run 就会生成）：

```
.cache/export/weapons.json        ExportWeapons.json
.cache/export/upgrades.json       ExportUpgrades.json
.cache/export/wfcd-mods.json      WFCD Mods.json（需 WFCD_INSECURE_TLS=1）
.cache/inspect/zkmods.json        本目录 extract-zkdata.mjs 生成
.cache/inspect/weapon-db.json     本目录 decode-weapon-db.mjs 生成
```

`node --experimental-strip-types <脚本>` 运行（需要从仓库根目录）。

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
