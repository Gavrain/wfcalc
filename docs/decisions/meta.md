# 决策 · 协作与结构

> 怎么干活：文件拆分、仓库组织、流程约定。
> 索引见 [`README.md`](README.md)；编号全局唯一。

## 状态表

| 编号 | 标题 | 状态 | 日期 |
|---|---|---|---|
| D-000 | 历史教训索引 | 记录 | 2026-11-05 |
| D-003 | 建立争议修改先确认机制 | **已确认** | 2026-11-05 |
| D-005 | 计算内核的规格形态：伪代码 vs TypeScript | **已确认：伪代码为依据、确认一条实现一条** | 2026-11-05 |
| D-018 | 多模式武器的验证方式：先每类做一把标杆武器 | **已确认** | 2026-11-05 |
| D-102 | 计算内核按结算链阶段拆分（`main.ts` 1521 行 → 10 个阶段文件），行为不变 | **已确认（需求方 2026-11-06）** | 2026-11-06 |
| D-103 | demo 校对脚本拆分：公共 DOM shim + `checks/`，并把 `mergeWeaponOverride` 抽成模块 | **已确认（需求方 2026-11-06）** | 2026-11-06 |
| D-104 | 仓库瘦身：决策正文归档、`research/poc` 留档说明、`data-todo` 并入态势待办 | **已确认（需求方 2026-11-06）** | 2026-11-06 |
| D-105 | `app.js` 按「数据层 / 计算层 / UI」拆成 4 个模块（需求方选 B） | **已确认（需求方 2026-11-06 选 B）** | 2026-11-06 |
| D-106 | 长期未确认的 11 条决策逐条结账（多数代码已实现，只差追认） | **待确认** | 2026-11-06 |
| D-143 | 根目录 16MB 单文件 demo（`20261031紫卡模拟器V10.html`）由 D-104「不动」改为**归档**到 `research/poc/archive/`（可逆，取代「不动」） | **已确认 / 已实施**（本次会话指令） | 2026-11-08 |

## 正文

### D-000 历史教训索引（状态：记录）

先做了再被纠正的三件事，作为反例保留：

| # | 我当时做的 | 实际正确的 | 教训 |
|---|---|---|---|
| 1 | 把近战全部归为 `melee`，取消细类 | 近战专属 Mod 不能用于所有近战，必须区分类型 | 分类能否合并，看**是否影响数据可用性**，不是看"当前计算会不会用到" |
| 2 | 判断"游戏内没有套装"，建议全部删除 | `ExportModSet.json` 的 19 条就是套装加成 | 数据源里有整块内容时，先核实游戏语义再决定收不收 |
| 3 | 以为「近战·苦痛」加护甲并剔除 | 苦痛是复制异常状态（该保留）；加护甲的是「近战·坚壁」 | 按名字猜效果不可靠，必须看渲染后的完整描述 |

---

### D-003 建立争议修改先确认机制（状态：已确认）

- **日期**：2026-11-05
- **类别**：流程约定
- **背景**：本次会话中，多次出现我先按自己的逻辑做了修改、需求方在后续思考中才发现问题
  （见 D-000 三条）。需求方要求：**以后可能存在争议的修改，先提交建议等确认，
  并把理由写进 md 持久化**，否则理由只能在零散的对话里被看到。
- **我的建议**：新建 `docs/决策确认规范.md`（定义什么算争议修改、确认流程、记录格式）
  与本台账 `decisions.md`（逐条留档）。
- **理由与证据**：写在规范里可以被后续会话读到，对话里的理由会随上下文丢失。
- **备选方案**：只在对话里说明 → 不持久，不被后续会话看到。
- **结论**：需求方 2026-11-05 确认建立。

---

### D-005 计算内核的规格形态：伪代码 vs TypeScript（状态：已确认）

- **日期**：2026-11-05
- **类别**：结构变化
- **背景**：
  需求方问"要不要把乘区表建模转换成伪代码形式防止歧义"。我已把乘区表第 0~8 节全部转成
  `docs/伤害公式.md`（函数级伪代码 + 乘区表原文→代码的映射对照 + 三个校验例）。
  问题是这份伪代码停在"文档"层，还是继续做成可执行的 TypeScript。
- **我的建议**：
  1. `伤害公式.md` 作为实现依据，**每个函数都有唯一名字**（`applyElements` / `mergePairwise` /
     `critAverage` / `critTiers` / `dotTick` / `resolve` / `blastPerSecond` …）；
  2. `packages/core` 按同名函数实现，**测试名与文档小节号一一对应**（如 `4.1 校验例 1`）；
  3. 表里没写死的（本文 A-xx 标记）**确认一条实现一条**，未确认的先不写代码。
- **理由与证据**：
  伪代码已经当场抓出 13 处歧义（见 A-01~A-13 与本文第 10 节对照表），其中至少 4 处
  （元素合成优先级、玄骸两份数值、面板多重取哪个量、射线怎么认）会直接改变数值结果。
  这说明"只读中文表就实现"确实会跑偏——伪代码这一步是必要的，但不能只停在文档。
- **备选方案**：
  - A. 只写文档，代码另起：文档与代码会分叉，后续改动没人保证同步。
  - B. 直接写 TypeScript、不写文档：歧义会以"能跑的代码"形式固化，审阅门槛更高。
  - C. 先文档、确认后按同名函数实现（**本方案**）。
- **风险 / 不这么改的后果**：伪代码本身不会算错（不执行），但它会把"未决口径"固化成默认值，
  以后被当成"已经定好的"用。
- **结论**：需求方 2026-11-05 选择「伪代码为依据，确认后按同名函数实现」。
  → `伤害公式.md` 的函数名即为 `core` 的公开 API 名；测试名带文档小节号；未确认项不写代码、显式报"口径未定"。

---

### D-018 多模式武器的验证方式：先每类做一把标杆武器（状态：已确认）

- **日期**：2026-11-05
- **类别**：数据取舍 / 归类判定（"某个模式是什么"）+ 验证范围
- **背景**：
  在准备写计算内核时，我扫了一遍多模式武器：主武器 108 / 副武器 54 / 近战 32 / 重枪 9 把带多个模式，
  这些 `mode2` 的 `role` 一律是 `normal`、没有 `sourceKey`，**在产出里看不出它到底是什么**。
  我原本把它们判为"疑似脏数据"，准备整类处理。需求方纠正：**这些模式是真实存在的，只是含义不同**，
  并逐把确认了样例：

  | 武器 | `mode2` 的真实含义 | 数值（primary → mode2） |
  |---|---|---|
  | Braton | **灵化模式** | 24 → 50 |
  | Boltor | **灵化模式** | 25 → 4 |
  | Grakata | **功能卡提供的额外射击模式** | 11 → 11 |
  | Ambassador | **蓄力模式** | 29 → 600 |

  → 结论：**不能按数值大小或模式序号猜类型**（Grakata 两个模式数值相同、Boltor 的 mode2 反而更小），
  也**不能靠批量规则判断**。这与 D-000 第 3 条教训同类：按特征猜用途不可靠。
- **我的建议（已采纳）**：
  1. **先做标杆武器验证**，不急着给 203 把多模式武器逐一归类：
     每个模式类型挑 1 把已确认的武器，把它的"模式含义"人工写进 `packages/data/src/manual/`，
     计算内核只对标杆武器做端到端校验（`伤害公式.md` §11 的校验例 + 标杆武器全链路）。
  2. 未被确认的模式**不猜**：计算内核里按"普通射击"计算，但 UI 明确标注"模式含义未核实"，
     数据层保留原样（不改 `generated/`，不剔除）。
  3. 其余武器的归类进 `data-todo/`，列为后续维护项。
- **理由与证据**：上面 4 把武器的对照表说明"同一个 `mode2` 标签下至少混了 3 种语义
  （灵化 / 额外射击 / 蓄力）"。在没有逐把核实前，任何批量归类都会把错误固化进计算。
  标杆武器只需要 4 把就能覆盖 4 种语义，后续归类是等比放大，先验证再推广更稳。
- **备选方案**：
  - A. 逐把人工归类全部 203 把（**工作量大、且需要需求方逐把判断，先不做**）。
  - B. 按数值特征自动推断（被证伪：Grakata / Boltor 反例）。
  - C. 每类一把标杆 + 其余标"未核实"（**本方案**）。
- **风险 / 不这么改的后果**：标杆武器之外的武器，若用户选了含义特殊的模式，结果可能偏差；
  但 UI 有"未核实"标注，不会把错误当成已确认结论。
- **结论**：需求方 2026-11-05 确认：「先每个类型弄一把标杆武器出来，用于验证，其他的后续再维护」。

---

### D-102 计算内核按结算链阶段拆分（状态：**已确认**，需求方 2026-11-06 追认）

- **日期**：2026-11-06
- **类别**：结构变化（文件/导出归属）——**不改数字、不改口径、不改导出面**
- **需求方原话**：「现在的项目有点臃肿和耦合，每次改需求 DSH 阅读的东西太多了，请帮我设置合理架构，拆分一下。」

**现状（拆前实测）**

| 文件 | 行数 | 问题 |
|---|---|---|
| `packages/core/src/main.ts` | 1521 | 一条链 L0→L6 + 状态树 + 输出口径 + 废弃别名全在一个文件 |
| `main.ts ↔ weapon-state.ts` | 双向依赖 | `weapon-state` 的元素合成要靠 `main` 补填（`buildState()`） |

**已落地**

`main.ts` 拆成 10 个阶段文件，`main.ts` 只剩 21 行 re-export：

| 文件 | 行数 | 内容 |
|---|---|---|
| `ctx.ts` | 60 | `Ctx` / `CtxOptions` / `HeadshotOptions` / `buildContext` |
| `elements.ts` | 224 | 配对表 / `pairOf` / `ElementSlot` / `applyElements` / `mergePairwise` / `addSpread` |
| `crit.ts` | 116 | 暴率·爆伤·分档·爆头·`damageLine`·`expectedHitMultiplier` |
| `dot.ts` | 137 | `DOT_*` / `totalProcChance` / `share` / `stacksPerShot` / `multishot` / `dotTick` |
| `blast.ts` | 78 | `BLAST` / `blastDetail`（独立机制，D-031） |
| `timeline.ts` | 48 | `isFiringAt` / `firingFraction` / `buildFiringTimeline` |
| `six-second.ts` | 95 | `dotSixSecondCurve` / `IMMEDIATE_TICK` / `DOT_MAX_STACKS` / `hasDotElement` |
| `segment.ts` | 175 | `buildVectors` / `applyKuvaBonus` / `applyBaseDamage` / `factionFor` / `resolveSegment` |
| `output.ts` | 162 | `OutputId` / `OUTPUT_IDS` / `buildOutput` / `fireRateFinal` |
| `compute.ts` | 156 | `ComputeResult` / `compute` / `bucketBreakdown` |

- **导出面逐字不变**：`index.ts` 与 `main.ts` 的旧导入路径照旧可用；
  新增 `packages/core/test/exports.test.ts` 锁住拆前 94 个公开名字；
- **拆掉双向依赖**：`weapon-state.ts` 直接调 `elements.ts`，`元素槽位`/`命中分布` 由 `buildWeaponState()` 自己产出。

**回归**：全量 **419 项测试全绿**；`check-browser-load` 21 个 .ts 全过；`http-crawl` 24 个模块全 200；
`demo:check` 的 9 个内核校验脚本全过。

- **结论**：需求方 2026-11-06 确认「三个都做」，本项按上表实施并保留。

---

### D-103 demo 校对脚本拆分（状态：**已确认**，需求方 2026-11-06 追认）

- **日期**：2026-11-06
- **类别**：结构变化（脚本组织）——校对项只增不减

**现状（拆前实测）**

- `dom-interact.mjs`(803) / `verify-editor-layout.mjs` / `verify-override-e2e.mjs` / `verify-mode-panel-e2e.mjs`
  **各抄了一份** 40+ 行 DOM shim，各自实现 `app.js` 的 import 打桩，而且**都漏了** `weapon-picker.js` /
  `weapon-overrides.js` 两个导入；
- 7 个 `verify-*.mjs` 里，编辑器那组**全部不通过**（详见下）；
- `mergeWeaponOverride` 是纯函数，测试却靠正则从 `app.js` 里抠函数体，`app.js` 一改结构就红。

**已落地**

```
packages/demo/src/dom/shim.mjs        唯一一份 DOM shim + 从真实 index.html 建注册表
packages/demo/src/dom/load-page.mjs   载入 app.js：一次性替换全部 import（未登记的导入直接报错）+ invokeBoot()
packages/demo/src/dom/report.mjs      ✔/✖ 记账本 + 汇总 + 退出码
packages/demo/src/checks/interact.mjs       面板/拆解/口径/选单/数据标记 + 重启页面回归（78 项）
packages/demo/src/checks/mode-status.mjs    槽位拖拽/筛选/搜索/玄骸/用语（86 项）
packages/demo/src/checks/editor-layout.mjs  编辑器布局与文案（42 项）
packages/demo/src/checks/override-merge.mjs 纯逻辑：mergeWeaponOverride（24 项，不需要服务器）
packages/demo/src/checks/editor-save.mjs    保存接口校验（14 项）
packages/demo/src/checks/override-e2e.mjs   保存 → 重启 → 面板变（6 项）
packages/demo/src/checks/mode-panel.mjs     模式级 override 端到端（4 项）
packages/demo/src/checks/status-sync.mjs    触发几率同步到各段（7 项）
packages/demo/public/weapon-override.js     mergeWeaponOverride（页面与测试共用同一份）
```

被替换的旧脚本（`dom-interact.mjs` / `verify-editor*.mjs` / `verify-override-*.mjs` /
`verify-mode-panel-*.mjs` / `verify-status-sync.mjs`）已删除，`package.json` 两个聚合命令指向新路径。

**顺带修掉的既有 bug（全部是「测试与实现脱节」，不是新口径）**

1. `server.mjs` 的模式字段白名单写的是 `segments`，而 D-083 之后段只在 `variants[]` 里
   → **编辑器保存的每一次请求都被 400 拒掉**（「模式字段「variants」不可编辑」）。已改为放行 `variants`；
2. 5 个编辑器校验脚本的**测试载荷仍是 D-083 之前的形状**（模式上直接挂 `segments`）→ 已按 `variants[]` 重写；
3. `verify-editor-layout` / `verify-status-sync` 调用了 `app.js` 里**不存在的函数**
   （`groupWeapons` / `modeSegments`），且 `modeSegments` 在 `app.js` 里确实存在、只是签名不同 → 已修；
4. `verify-mode-panel-e2e.mjs` 整个文件是**乱码**（中文断言里嵌了 `'`，SyntaxError 跑不起来）→ 按原意重写；
5. 所有编辑器脚本都假设 `packages/data/src/manual/weapon-overrides.json` 已存在 → 新增 `editor-save.mjs`
   不再依赖它，其余脚本「没有就临时建、结束还原」。

**回归**：8 个新脚本全绿（78 + 86 + 42 + 24 + 14 + 6 + 4 + 7）；`http-crawl` 25 个模块全 200。

- **结论**：需求方 2026-11-06 确认，按上表实施。

---

### D-104 仓库瘦身：台账归档 / 研究留档 / 待办合并（状态：**已确认**，需求方 2026-11-06 追认）

- **日期**：2026-11-06
- **类别**：范围增减（文档目录）；**不删内容，只移动**

**已落地**

| 对象 | 之前 | 现在 |
|---|---|---|
| `docs/decisions.md` | 4027 行（状态表 + 全部正文混排） | **133 行**：状态表 + 「正文在哪」+ 最近条目（D-102~D-106） |
| 历史正文 | 同上一份 | `docs/decisions/000-D005-D016.md`（351 行）、`docs/decisions/001-D000-D104.md`（1783 行），**逐条搬移未改写** |
| `research/poc/` | 14 个一次性脚本与结论并列 | 脚本移入 `research/poc/archive/`；新增 `research/README.md` 注明「仅为留档」 |
| `data-todo/README.md` | 与 `docs/态势与待办.md` 两处维护 | 内容并入 `docs/态势与待办.md` 的「待人工补充的数据」；数据文件（`aoe-falloff.auto.json` 等）留在原位 |
| 根目录紫卡模拟器 HTML | 15.4 MB | 已确认 `.gitignore` 排除、不引用，**不动** |

- **结论**：需求方 2026-11-06 确认，按上表实施。

---

### D-105 `app.js` 的分层方案（状态：**待确认 → 已确认，选 B**）

- **日期**：2026-11-06
- **类别**：结构变化（前端文件组织）
- **背景**：需求方问「app 那边需不需要拆成多个模块，数据层、计算层、UI 也独立出来？」
- **现状（实测，见下表「行数」列）**：`app.js` 2284 行 / 84 个函数，其中
  - **数据层**：8 个函数 138 行——把 `generated/` + `mods.json` 读进来、挑出可装 Mod、把 Mod/赋能转成 `Contribution`；
  - **计算层**：5 个函数 77 行——组装 `compute()` 的选项、跑一次计算、算「相对不上这张的提升」；
  - **UI 层**：其余 71 个函数 1959 行（渲染 352 / 拖拽 295 / 备选卡 243 / 控件 257 / 编辑器 354 / 选单 225 / 工具 152 / boot 81）。
- **我的建议**：**分三段、但不拆成十几个文件、更不切成独立进程**。理由：
  1. **计算层已经在 `packages/core` 了**，`app.js` 里的 77 行只是「把 UI 状态翻译成 `compute()` 的参数」，
     拆出去只会多一层跳转，**不建议单独成模块**；
  2. 真正值得独立的是**数据层 138 行**（`app-data.js`）：它对外只有「读数据 → 返回武器/Mod/赋能/贡献」，
     UI 完全不关心 JSON 长什么样；
  3. UI 里的**编辑器 354 行**和**武器选单 225 行**可以各自成文件（`ui-editor.js` / `ui-picker.js`），
     前提是先把跨文件共享的 `state` / `DATA` / `modSlots` 收敛成一个显式的 `store` 对象
     （现在 `state.` 出现 46 次、`modSlots` 31 次、`exilusModId` 19 次、`dragPayload` 16 次，
     直接拆文件会变成隐式全局，反而更乱）。

  建议的目标结构（每步都可单独回滚）：

  ```
  public/
    app.js          入口：boot + 主渲染编排（约 1600 行）
    app-store.js    跨模块共享状态（state / DATA / modSlots / dragPayload …）
    app-data.js     数据层：读 generated/ + 模组池 + 贡献转换（约 138 行）
    app-compute.js  计算层薄壳：选项组装 + runCompute + 边际提升（约 77 行）
    ui-editor.js    编辑器（约 354 行）
    weapon-picker.js 已验证存在
    weapon-override.js 已有
  ```

  - **分几步**：① 抽 `app-store` + `app-data`（行为不变，靠现有 78 项 `interact` 校对兜底）→
    ② 抽 `app-compute` → ③ 抽 `ui-editor`。每步跑 `demo:check` + `demo:editor-check` + `http-crawl`；
  - **不建议**：把 UI 拆成「样式 / 模板 / 事件」三层、或引入构建器——现在的零构建 + 服务器剥类型
    是刻意设计，拆成很多 `.js` 后首次加载会变成 10+ 个请求（本机无所谓，但上静态站要注意）。
- **备选方案**：
  - A. 只抽 `app-data.js`（138 行），其余不动——收益集中、风险最小；
  - B. 按上面 5 个文件拆（**本建议**）；
  - C. 一行不动——2284 行确实还能读，但要找「某个数字怎么变的」时仍旧要整份翻。
- **风险 / 不这么改的后果**：`app.js` 里 UI 与数据/计算混在一起，改口径展示时容易顺手改到数据层逻辑；
  改数据字段时要整读 2284 行。
- **结论**：需求方 2026-11-06 选 **B**（5 个文件拆法），实施记录见下一节。

---

### D-105 实施记录（需求方 2026-11-06 选 B）

**最终结构**（实测行数）

| 文件 | 行数 | 职责 |
|---|---|---|
| `public/app.js` | 2284 → **1284** | 入口 + 渲染编排 + 渲染函数 + 拖拽 + 武器切换 |
| `public/app-store.js` | **110** | 共享状态 `store`（ui / modSlots / exilusModId / arcaneKey / data / dataAll / dragPayload / gainCtx）+ 中文表 + 数字格式 |
| `public/app-data.js` | **125** | 数据层：`loadAllWeapons` / `buildWeaponData` / `clearLoadout` / `isExilusMod` / `isModAllowedOnWeapon` |
| `public/app-compute.js` | **143** | 计算层薄壳：`effectiveModeFor` / `currentContributions` / `computeOptions` / `runCompute` / `marginalGainOf` / `gainOf` |
| `public/ui-editor.js` | **343** | 开发态武器编辑器（编辑 / 保存 / overrides 合并 / 已修改标记） |

**做法**：三个阶段都**逐块搬运**（不是重写），搬过去的代码保持原注释；
共享状态统一走 `store`，跨模块函数通过显式 import；
编辑器与 app.js 之间的两个回调（`flash` / `renderAll`）用 `setEditorDeps()` 注入，
避免循环依赖。

**唯一一处刻意的重复**：`modeSegments()` 在 `app.js` 与 `ui-editor.js` 各有一份
（app.js 是普通脚本、不能导出），两边都写了「改一处要同步另一处」。

**回归**：全量 419 项测试全绿；8 个页面校对脚本 **240 项全绿**
（interact 57 / mode-status 86 / editor-layout 42 / override-merge 24 / editor-save 14 /
override-e2e 6 / mode-panel 4 / status-sync 7）；
`http-crawl` 29 个模块全 200；`check-browser-load` 覆盖了全部 7 个页面脚本。
另外 `weapon-select-sync.test.ts` 的源码断言跟着改成了 `store.data.weapon`（断言意图不变）。

- **结论**：按 B 实施完毕。

---

### D-106 长期未确认的决策清单（状态：**已逐条定案**，需求方 2026-11-06）

- **日期**：2026-11-06
- **类别**：把挂在"待确认"上的旧账逐条结掉（**改成选择题，逐条选 A 或 B**）
- **背景**：台账里 11 条停在"待确认"，但代码早就按某个方向做完了。
  选 **A = 维持现状（追认）**；选 **B = 按说明改**。每条都写了改起来影响多大。

---

### D-143 根目录 16MB 单文件 demo 由「不动」改为归档（状态：**已确认 / 已实施**，本次会话指令）

- **日期**：2026-11-08
- **类别**：范围增减（仓库根目录物理文件）——**不动代码、不动数据、不动 git**
- **背景**：需求方本次会话要求清理「DSv4.1flash 生成的一堆东西、文件夹混乱」。
- **历史口径**：D-104（2026-11-06）曾明确「根目录紫卡模拟器 HTML 15.4 MB → 已确认 `.gitignore` 排除、不引用、**不动**」。
- **本次变更**：需求方本次会话选择「A+B+C 一次性推进」，其中 A 档含「删 16MB 单文件 demo」。
  这是对 D-104「不动」的**推翻**。为避免不可逆，采用**归档**（可逆）而非硬删除：

| 对象 | 之前 | 现在 |
|---|---|---|
| `20261031紫卡模拟器V10.html`（15.4 MB） | 根目录（.gitignore 已排除，未入库） | 移到 `research/poc/archive/20261031紫卡模拟器V10.html` |

- **为什么归档而不硬删**：该文件从未进过 git（.gitignore 排除），硬删后无法从版本库恢复；
  归档到既有「留档」目录，根目录变干净，同时保留可恢复。
- **结论**：按需求方本次指令实施。若需求方希望**彻底删除**或**恢复「不动」**，改本条状态即可。

---
