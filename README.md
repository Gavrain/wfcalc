# 项目总览

Warframe 武器伤害模拟器（`wfcalc`）。核心诉求：**每个乘区都能复算、可拆解**。

范围：**只算武器自身能配置的加成**——Mod、赋能、紫卡、灵化、玄骸、自定义加成。
战甲 / 队友等武器之外的加成一律走「自定义加成」入口，不内建战甲模型。
不做敌人类型克制、护甲 / 护盾结算：本项目衡量的是**武器自身的输出能力**。

当前版本：**v1.0.0**（见 [`docs/releases/v1.0.0.md`](docs/releases/v1.0.0.md)）。

## 仓库结构

```
packages/
  core/        计算内核（纯函数、无 DOM，可独立测试）
  data/        数据层：清洗后的武器库、Mod/赋能/套装、人工维护层
  data-build/  抓取与清洗流水线
  demo/        本地配装页面（零依赖静态服务）
research/      研究记录（数据源验证、抓取口径、衰减模型）
docs/          文档（见下）
```

## 文档

| 想看什么 | 去哪 |
|---|---|
| 现在按什么算 | [`docs/specs/核心事实.md`](docs/specs/核心事实.md) |
| 架构设计 | [`docs/specs/架构设计/`](docs/specs/架构设计/) |
| 需求怎么来的 | [`docs/requirements/`](docs/requirements/README.md) |
| 每个版本改了什么 | [`docs/releases/`](docs/releases/README.md) |
| 怎么开发、怎么提交 | [`CONTRIBUTING.md`](CONTRIBUTING.md) |

## 常用命令

```bash
npm install
npm run check          # 类型检查 + 单元测试
node --test --experimental-strip-types --test-isolation=none "packages/*/test/**/*.test.ts"
npm run demo              # 主页 http://127.0.0.1:5178 · 检查页 http://127.0.0.1:5178/check
npm run build:offline     # 生成可双击打开的离线单文件 dist/wfcalc-standalone.html
npm run build:data        # 重新抓取武器数据
npm run build:mods        # 重新生成 Mod 数据
```

需要 **Node ≥ 20**。

## 许可证

[MIT](LICENSE) © 2026 Gavrain
