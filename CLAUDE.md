# 协作约定（入口）

Warframe 伤害模拟器（`wfcalc`）。核心诉求：**每个乘区都能复算、可拆解**。

**完整流程与纪律见 [`CONTRIBUTING.md`](CONTRIBUTING.md)。本文件只列红线，每次动手前扫一眼。**

## 红线

1. **先给方案，确认后才动代码**。任何会改变仓库的操作都算；"修 bug"不是免问牌。
2. **已确认的口径以 [`docs/specs/核心事实.md`](docs/specs/核心事实.md) 为准**。代码注释只留一行 `// 依据：核心事实 §X`，不写过程。
3. **数据能追溯**：人工推断补的字段必须带 `_manual` 或 note。
4. **对需求方讲人话**：不甩编号与术语，每个选项讲清后果，明确推荐一个。
5. **做界面功能不主动跑校验**，等需求方说可以了再跑。
6. **改口径前先贴原文对照**：点名乘区 / 贴核心事实原文 / 说清依赖 / 写一行怎么核对的。

## 目录速查

```
packages/core/      计算内核（纯函数）
packages/data/      数据层（src/generated 是产物，勿手改；src/manual 是人工层）
packages/data-build/ 抓取清洗流水线
packages/demo/      本地配装页面
docs/specs/         口径与设计（结论）
docs/requirements/  需求（来龙去脉）
docs/releases/      发布记录
research/           研究记录
```

## 常用命令

```bash
npm run typecheck
node --test --experimental-strip-types --test-isolation=none "packages/*/test/**/*.test.ts"
npm run demo          # http://127.0.0.1:5178
npm run build:offline # 离线单文件 dist/wfcalc-standalone.html
```

> 默认的 `npm test` 在本机沙箱里会因 spawn EPERM 失败，用上面带 `--test-isolation=none` 的命令。
