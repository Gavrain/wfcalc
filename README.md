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
  demo/        本地计算内核 demo（零依赖静态服务 + 配装页）
research/      研究记录（模型梳理、数据源验证）
docs/          规格文档
data-todo/     待人工补充的数据清单
```

## 当前状态

> 详细态势（已完成 / 进行中 / 待回答的问题）见 [`docs/态势与待办.md`](docs/态势与待办.md)，本节只列里程碑。

- [x] 数据源可行性验证（见 `research/01-数据源可行性验证.md`）
- [x] 武器面板收集与乘区确认（乘区归属表 9 节全部确认）
- [x] Mod 数据抓取（442 武器 Mod + 56 武器赋能 + 19 套装，见 `research/03-Mod数据抓取.md`）
- [x] 伤害计算模型文档（`docs/伤害公式.md`，A-01~A-14 已裁定，仅剩 A-03 待修）
- [x] 抓取清洗流水线（武器 ✓ / Mod ✓ / 赋能 ✓ / 套装 ✓）
- [x] 计算内核·零件（`buckets` / `damage-types` / `kuva` / `status-effects`）
- [x] 计算内核·主结算链（`contributions` → `buckets` → `main` → `analysis`）
- [x] 本地 demo（赤毒·卡拉克配装页，含逐乘区拆解与备选 Mod 增幅）
- [ ] 标杆武器端到端验证（D-018，目前只验了赤毒·卡拉克）
- [ ] 配置方案模型（`docs/配置方案模型.md` 尚未编写）
- [ ] 正式 UI

## Demo

```bash
node packages/demo/src/server.mjs
# 打开 http://127.0.0.1:5178
```

页面结构：

- **左**：赤毒·卡拉克的面板 → 加成后面板（随 Mod 实时更新）、伤害分布、玄骸元素/加成、六个输出口径（可单选）
- **中上**：两行四列 Mod 槽位 + 右侧「赋能槽 / 劣化槽」（劣化槽只收功能类 Mod）
- **中下**：备选 Mod 区（当前武器可装的 122 张步枪 Mod），每张显示名字、词条、**对当前配置的伤害增幅**；
  「增幅基准」用单选按钮切换（单弹头 / 单次射击 / 每秒命中 / 持续射击 / DoT 每秒 / DoT 0~6 秒）
- **右**：点任意备选 Mod 看拆解（各乘区加了多少、元素合成过程、暴击分档）

> demo 用 Node 内置的 `module.stripTypeScriptTypes()` 把 `.ts` 直接送到浏览器，**不需要打包器**。
>
> ⚠ 服务器同时接受 `.js` 与 `.ts` 两种请求、都映射到同一份 `.ts` 源文件：浏览器拿到的模块说明符是
> `.js`（`import './damage-types.js'`），而仓库里只有 `.ts`。改动这块后请跑
> `npm run demo:crawl`——它会沿着模块图把每个模块**真的 HTTP 请求一遍**，确认没有 404。

## 开发

需要 **Node ≥ 20**（本机已换到 24.22.2）。

```bash
npm install
npm run typecheck
npm test         # 内核单测 + 数据流水线测试
npm run build:data  # 重新抓取并生成武器数据（需网络）
npm run build:mods  # 重新生成 Mod 数据（数值来自入库的 mods/baseline.json）
```

> 若在受限环境里 `npm` 报 `EPERM ... npm-cache`，改用
> `node --test --experimental-strip-types --test-isolation=none "packages/*/test/**/*.test.ts"`。

## 开发态武器编辑器

本地 \
pm run demo\ 起来后，「武器面板」右上角会出现 **编辑** 按钮：

- **可编辑**：暴击几率 / 暴击伤害 / 触发几率 / 射速 / 弹匣 / 装填时间、
  每个模式的 \	rigger\（发射器类型）与触发几率、伤害分布（**可增删伤害类型**）
- **不可编辑**：面板总伤（恒等于伤害分布之和，只读）、武器 id / 模式 id
- **保存**：写入 \packages/data/src/manual/weapon-overrides.json\（人工层），
  不会碰 \generated/\，重新抓取数据不会覆盖
- **仅开发态**：前端靠 \GET /__dev\ 探针判断；部署成静态页时没有后端，
  按钮不渲染。\POST /__save-weapon\ 只存在于本地服务
- 保存后武器标题旁显示「已修改」标记
- **保存即生效**：不需要刷新页面，编辑器保存后会重新合并 overrides 并重渲染

接口自检：\
pm run demo:editor-check\（需 demo 服务在跑）