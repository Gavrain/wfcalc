# 数据层说明

## 目录

```
src/generated/weapons/     流水线生成，勿手改
  primary.json             主武器
  secondary.json           副武器
  melee.json               近战（含战甲技能武器）
  archgun.json             空战枪械
  archmelee.json           空战近战
  companion.json           同伴武器
  index.json               分类统计与索引
src/manual/                人工维护层，改这里
  overrides.ts             修正导出错误或缺失的数值
  weapon-effects.ts        武器被动效果表
```

## 字段口径

| 字段 | 含义 | 单位 |
|---|---|---|
| `critChance` | 暴击几率 | **0~1 小数**（0.45 = 45%） |
| `critMultiplier` | 暴击倍率 | 倍数（2 = 2 倍） |
| `statusChance` | 触发几率 | 0~1 小数 |
| `fireRate` | 射速 / 攻击速度 | 发每秒（近战为攻速，同一字段） |
| `magazineSize` / `reloadTime` | 弹匣容量 / 换弹时间 | 发 / 秒 |
| `segments[].damage` | 该段伤害分布 | 绝对值 |
| `segments[].procChance` | 该段触发几率 | 0~1 小数 |
| `segments[].aoe` | 是否范围伤害 | 布尔 |

## 多攻击模式

`modes[]` 每项是一个攻击模式：

| `role` | 含义 |
|---|---|
| `normal` | 普通射击（含"只能蓄满发射"的武器） |
| `charged` | 蓄力射击，数值与普通不同时才单独存在 |
| `incarnon` | 灵化模式，暴击/触发需人工补 `override` |

`trigger` 对应官方导出的触发方式（`auto` / `semi` / `burst` / `charge` / `held` / `active`）。

## 玄骸武器

带 `kuva` 字段的武器需要用户在计算器里选择元素与加成：

```json
"kuva": { "bonusRange": [0.25, 0.6], "elements": ["impact", "puncture", "slash", "heat", "cold", "electric", "toxin"] }
```

加成范围固定为 25%~60%，具体数值由用户在计算器里输入，数据层不预设。

## 修改数据的方式

**不要直接改 `src/generated/` 下的文件**——下次运行流水线会被覆盖。

要修正某个数值，改 `src/manual/overrides.ts`：

```ts
export const WEAPON_OVERRIDES = {
  Railgun: { chargeTime: 0.5, note: '导出射速为 0，按蓄力反推' },
  // 新增一条即可
};
```

然后重新生成：

```bash
node --experimental-strip-types packages/data-build/src/index.ts --emit
```

被人工改过的字段会在产出里留下 `_manual` 标记，记录原值、新值与理由。
