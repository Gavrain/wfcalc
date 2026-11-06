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
  src/ctx.ts          结算上下文（武器 + 模式 + 贡献 + 选项）
  src/elements.ts     ③④⑤ 物理% / 元素% / 两两合成
  src/crit.ts         L3 暴击 + 爆头
  src/dot.ts          L4 触发率与 DoT 每跳
  src/blast.ts        爆炸异常（独立机制，D-031）
  src/timeline.ts     开火时间线（装填空窗）
  src/six-second.ts   六秒异常状态总伤（逐秒曲线）
  src/segment.ts      L0 切段 → ① 玄骸 → ② 基伤 → 单段结算
  src/output.ts       L6 输出口径
  src/compute.ts      compute() + WeaponState 状态树
  src/weapon-state.ts 输入层 / computed 层
  src/main.ts         只做 re-export（旧导入路径仍可用）
packages/data/        数据层：generated/ 是流水线产物（勿手改），manual/ 是人工层
packages/data-build/  抓取清洗流水线
packages/demo/        本地页面 demo（零依赖静态服务 + 配装 UI）
  public/app.js       页面本体：渲染编排 / 拖拽 / 武器切换（1284 行）
  public/app-store.js 共享状态 store + 中文表 + 数字格式
  public/app-data.js  数据层：读 generated/ JSON、挑可装 Mod
  public/app-compute.js 计算层薄壳：组装 compute() 参数、算相对提升
  public/ui-editor.js 开发态武器编辑器
  public/weapon-picker.js   武器选单（纯 JS 模块）
  public/weapon-override.js override 合并规则（纯 JS 模块，页面与测试共用）
  src/server.mjs      静态服务 + 开发态 `/__save-weapon` 校验
  src/dom/            校对用 DOM shim + 页面装载器 + 记账本
  src/checks/         页面级校对脚本（`demo:check` / `demo:editor-check`）
  src/verify-*.mjs    纯内核校验（不跑页面）
research/             研究记录（01~06 结论）；一次性探查脚本在 research/poc/archive/（留档，不保证能跑）
docs/                 规格与决策（乘区归属表、决策确认规范）
  decisions.md        状态表 + 最近条目（先读这个，改口径前必看）
  decisions/          历史正文归档（grep 用）
data-todo/            数据文件（aoe-falloff.auto.json / wfcd-confirm.*）；清单正文已并入 docs/态势与待办.md
```

## 改需求时先看哪份（别整读）

| 要改的是 | 先读 | 不用读 |
|---|---|---|
| 某条口径现在怎么算 | `docs/乘区归属表.md` | 全部代码 |
| 某条口径为什么这么定 | `docs/decisions.md` 的**状态表**（先按编号 grep） | 整份台账 |
| 公式 / 结算顺序 | `docs/伤害公式.md` + 上面对应的阶段文件 | `main.ts`（只有 re-export） |
| 某个展示数怎么来的 | `docs/变量依赖图.md` / `docs/数值推导.md` | 数据流水线 |
| 数据字段来自哪 | `research/0x-*.md` | 内核 |

内核改动只应落在**一个阶段文件**里；一次需求要同时改 `segment.ts` 和 `output.ts` 时，
先在 `decisions.md` 写清为什么（多半说明口径分界画错了）。

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
