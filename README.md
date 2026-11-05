# Warframe 伤害模拟器

面向 Warframe 武器伤害的**可复算**模拟器：每个乘区都能在调试 UI 里看到贡献拆解，配置方案可保存分享。

范围（v0.1）：**只算武器本身能配置的加成**——Mod、赋能、紫卡、灵化、自定义外部加成。
战甲/队友等武器之外的加成，一律走「自定义加成」入口，不内建战甲模型。

## 仓库结构

```
packages/
  core/        计算内核（纯函数、无 DOM，可独立测试）
  data/        数据层：Schema、清洗后的武器库、人工维护层（灵化/赋能/AoE）
  data-build/  抓取与清洗流水线（官方导出 → 校验 → 入库）
  debug-ui/    一期调试界面（计算内核 + 极简 UI）
research/      研究记录（模型梳理、数据源验证）
docs/          规格文档
data-todo/     待人工补充的数据清单
```

## 当前状态

- [x] 数据源可行性验证（见 `research/01-数据源可行性验证.md`）
- [x] 武器面板收集与乘区确认（乘区归属表 9 节全部确认）
- [x] Mod 数据抓取（442 武器 Mod + 56 武器赋能 + 19 套装，见 `research/03-Mod数据抓取.md`）
- [ ] 伤害计算模型文档（公式测试用例）
- [ ] 抓取清洗流水线（武器 ✓ / Mod ✓ / 赋能 ✓ / 套装 ✓）
- [ ] 计算内核
- [ ] 调试 UI
- [ ] 正式 UI

## 格式约定

- 数值类型区分 `Flat`（绝对值）与 `Percent`（百分比），禁止用裸 `number` 跨乘区传递。
- 伤害类型统一用 `DT_*` 的语义化别名（`impact`/`puncture`/`slash`/`heat`/`cold`/`electric`/`toxin`/`blast`/`gas`/`magnetic`/`radiation`/`corrosive`/`viral`/`void`）。

## 开发

```bash
pnpm install
pnpm test        # 内核单测 + 金样本回归
pnpm build:data  # 重新抓取并生成武器数据（需网络）
pnpm build:mods  # 重新生成 Mod 数据（需紫卡模拟器 HTML 快照）
```
