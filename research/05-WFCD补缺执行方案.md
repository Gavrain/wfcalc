> ⚠ 本文的"半径推断"部分已被 D-070 第五轮口径取代（两种衰减模型），
> 现行口径见 `research/06-衰减模型与面板展示.md`。

# 用 `@wfcd/items` 补缺：现在还剩什么要你填

> 结论：AoE 衰减参数基本都能自动确定，CSV 只剩 **81 行**（79 个半径 + 2 个面板冲突）。
> 生成器 `packages/data-build/src/review-sheets.ts` 只读，跑一次：

```bash
node --experimental-strip-types packages/data-build/src/review-sheets.ts
```

---

## 1. 已经自动确定的（不用看）

| 产出 | 内容 |
|---|---|
| `data-todo/aoe-falloff.auto.json` | 46 段 AoE 的 `start / end / reduction / radius`，全部确定 |

规则：

1. 本地爆炸段 ↔ WFCD AoE 攻击**按伤害内容**对位（不按下标）；
2. WFCD 的重复计数先去掉；
3. `reduction = 0` → 该段不衰减（不填任何数）；
4. `shot_type ≠ AoE` 的 `falloff` 是**弹道射程**，不采纳（黑鸦 Prime 就是这种）；
5. **半径由衰减距离推出**：同一把武器上 `end` 不同的 AoE 是尺寸不同的两个爆炸，
   短的那个 = 手雷本体 + 衰减区（`end` 就是外缘半径），长的那个是**贴脸爆心半径**：

```
radius = max(end)                     ← 外缘半径
falloffStart = min(end) − max(end)    ← 内圈不衰减的距离
falloffEnd   = max(end)
```

例：`CrpElectroMag` 两个爆炸 `end = 2.4` 与 `9.6`
→ 半径 9.6m，内圈 7.2m 内不衰减，7.2~9.6m 线性衰减到 30%。

---

## 2. 要你填的（`data-todo/wfcd-confirm.csv`，81 行）

列：`类别 / row_key / 武器 / 模式 / 本地现值 / WFCD 参考 / 要填的列 / 填写 / 说明`。
**只填「填写」这一列**，其它别动（`row_key` 是回填时定位用的）。

### 2.1 `类别 = AoE 半径`（79 行）

WFCD 只给了**一种**衰减终点，说明这把武器只有一个尺寸的爆炸，
没法区分"外缘半径"和"爆心半径"——这是 WFCD 本身推不出来的，只能你给半径（米）。

- 填一个数，例如 `7`、`4.5`；
- 同一发爆炸的 `explosiveAttack` 和 `embedDeathAttack` 已合并成一行，填一次对两段都生效；
- 真实半径没人知道时可以留空，表示"该段暂不建模衰减"（不影响别的段）。

### 2.2 `类别 = 面板冲突`（2 行）

**同一个伤害在 WFCD 里有两条攻击、面板不同**，不知道该用哪个：

| 武器 | WFCD 的两条 | 本地现值 |
|---|---|---|
| 武使之力 Battacor | `Secondary Fire`（触发 8%） / `Secondary Fire AoE`（触发 50%） | 0.32 / 2.4 / 0.18 |
| 丝蛛皇 Spinnerex | `Normal Attack`（触发 40%） / `Slam Attack`（触发 10%） | 0.16 / 2.4 / 0.4 |

填「暴率/暴伤/触发」，例如 `0.32/2.4/0.5`（概率写 0~1 小数）。

> 其余灵化/多模式武器的面板：**WFCD 只有一条攻击的，说明它和本地本来就一致，没进表**；
> `role=incarnon` 的 7 把（帕里斯系、恐惧、连弩、弹弓系）WFCD 给了不同数值，
> 但那属于"WFCD 的 wiki 口径 vs 你确认过的本地口径"之争，不在这份表里，
> 需要时再单独开（见 `data-todo/README.md` 第 2 节）。

---

## 3. 已删除的旧表

| 旧文件 | 原因 |
|---|---|
| `wfcd-aoe-falloff.csv`（152 行） | 大部分已自动确定；剩下的半径行长且杂，已被 `wfcd-confirm.csv` 取代 |
| `wfcd-incarnon-panel.csv`（71 行） | 里面绝大部分是"WFCD 面板与本地不同"的多模式武器，不是错误，属噪音 |

---

## 4. 填完之后

回填脚本**尚未编写**（等表回来再做，届时再确认一次落盘形状）：

1. `aoe-falloff.auto.json` → `packages/data/src/manual/aoe-falloff.ts`（带 `source: wfcd@1.1276.47`）；
2. `wfcd-confirm.csv` 的 `填写` 值覆盖到同一条记录上；
3. 内核目前**不读** AoE 半径/衰减，接入要改结算链（另需确认，属于口径变更）。
