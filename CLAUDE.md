# 项目协作约定

Warframe 伤害模拟器（`wfcalc`）。核心诉求：**每个乘区都能复算、可拆解**。

## 最重要的规则（每次动手前先读）

### 1. 有争议的修改必须先确认，并把理由写进 md

**不要直接改**下面这些，先写进 `docs/decisions.md` 的「待确认」条目再问需求方：

- 改动已确认的口径（乘区归属、公式、结算顺序、分类规则）
- 数据取舍（收录/剔除某类 Mod、赋能、套装；某一层要不要建模）
- 归类判定（武器归哪类、属性归哪乘区、某数据算不算影响伤害）
- **以我的判断填补缺失值**（导出没有、靠推断补的）
- 改变产出结构（字段改名/删除/语义变化）
- 范围增减（新增/移除数据源或数据层）

流程：写 `decisions.md` → 提问说明（改什么/为什么/证据/备选/风险）→ 确认后改状态再动代码。

可以直接做（不用问）：修 bug、修笔误、补测试、补文档、行为不变的重构、执行已明确说过的规则。

原因是：只在对话里说理由，需求方要到后续思考时才看到，容易先做再返工。

### 2. 已确认的口径以 `docs/乘区归属表.md` 为准

那份文档第 0~8 节全部经需求方逐条确认，是计算内核的实现依据。改它要走上面的确认流程。

### 3. 数据能追溯

每个数值都要能回答"哪来的"。产出里的字段若来自人工推断，必须带 `_manual` 或 note 说明原因。

## 目录

```
packages/core/        计算内核（纯函数，无 DOM）
packages/data/        数据层：generated/ 是流水线产物（勿手改），manual/ 是人工层
packages/data-build/  抓取清洗流水线
research/             研究记录（数据源验证、抓取口径）
docs/                 规格与决策（乘区归属表、决策确认规范、决策台账）
data-todo/            待人工补充的数据清单
```

## 常用命令

```bash
npm run typecheck
node --test --experimental-strip-types --test-isolation=none "packages/*/test/**/*.test.ts"
npm run build:mods     # 重新生成 Mod/赋能/套装数据
npm run build:data     # 重新抓取武器数据
```

> 注：默认的 `npm test` 在本机沙箱里会因 spawn EPERM 失败，用上面带 `--test-isolation=none` 的命令。

## 环境坑

- 本机 PowerShell/curl 的 TLS 有凭据异常，抓取一律走 Node 的 `fetch`。
- GitHub 域名在本机被 TLS 中间人拦截（`UNABLE_TO_VERIFY_LEAF_SIGNATURE`），
  抓 WFCD 需要 `WFCD_INSECURE_TLS=1` 或直接用缓存。
- `packages/core/src/buckets.ts` 的部分注释是**历史遗留的乱码**（双重转码，无法还原），
  不要照着改代码逻辑，以 `docs/乘区归属表.md` 为准。
