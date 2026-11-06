/**
 * 计算内核的**公开入口**：只负责把各阶段再导出（D-102）。
 *
 * 每个阶段一个文件，按 `docs/伤害公式.md` 的结算链顺序：
 *
 * ```
 * ctx.ts          上下文（Ctx / CtxOptions / buildContext）
 * elements.ts     ③④⑤ 物理% / 元素% / 两两合成
 * crit.ts         L3 暴击 + 爆头
 * dot.ts          L4 触发率与 DoT 每跳（含 multishot）
 * blast.ts        爆炸异常（D-031，独立机制）
 * timeline.ts     开火时间线（装填空窗，D-058 / D-067）
 * six-second.ts   六秒异常状态总伤（逐秒曲线）
 * segment.ts      L0 面板切段 → ① 玄骸 → ② 基伤 → 单段结算 resolveSegment
 * output.ts       L6 输出口径（buildOutput）
 * compute.ts      一站式 compute() + WeaponState 状态树 + 各乘区拆解
 * ```
 *
 * 修一条口径只需打开对应阶段文件；本文件与 `index.ts` 一起保证
 * 「`import … from 'main.ts'` / `index.ts`」的旧路径继续可用。
 */
export * from './ctx.ts';
export * from './elements.ts';
export * from './crit.ts';
export * from './dot.ts';
export * from './blast.ts';
export * from './timeline.ts';
export * from './six-second.ts';
export * from './segment.ts';
export * from './output.ts';
export * from './compute.ts';
