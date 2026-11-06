/**
 * 测试用构造器：按 `AttackMode` 造模式。
 *
 * D-080 之后 `AttackMode` 上**没有** `segments` 字段——段只属于变体。
 * 这里提供两种写法：
 *   · `modeWithSegments({...})` —— 给一组段，自动按「爆炸 / 其余」拆成变体
 *   · `mode({ ...mode, variants })` —— 直接给变体（需要变体级 override 时用）
 *
 * ⚠ 本文件只给测试用，不进产出。
 */
import type { AttackMode, DamageSegment, ModeVariant, PanelOverride } from '../src/weapon.ts';

/** 与 `data-build/src/clean.ts` 的 `toVariants()` 同规则 */
export function splitVariants(segments: DamageSegment[]): ModeVariant[] {
  const direct = segments.filter((s) => s.kind !== 'explosiveAttack');
  const blast = segments.filter((s) => s.kind === 'explosiveAttack');
  const out: ModeVariant[] = [];
  if (direct.length) out.push({ id: 'direct', label: '直接命中', segments: direct });
  if (blast.length) out.push({ id: 'blast', label: '爆炸', segments: blast });
  return out;
}

/** 直接给变体（需要变体级 override 时用） */
export function mode(spec: AttackMode): AttackMode {
  return spec;
}

/** 给一段或多段，自动拆成变体（最常用） */
export function modeWithSegments(
  spec: Omit<AttackMode, 'variants'>,
  segments: DamageSegment[],
): AttackMode {
  return { ...spec, variants: splitVariants(segments) };
}

/** 便捷：造一个单段模式 */
export function simpleMode(
  spec: Omit<AttackMode, 'variants'>,
  damage: Record<string, number>,
  kind: DamageSegment['kind'] = 'impact',
  procChance = 0.3,
): AttackMode {
  return modeWithSegments(spec, [{ kind, aoe: kind === 'explosiveAttack', procChance, damage }]);
}

/** 造一个单面板覆盖（便于测试变体级 override） */
export function panelOverride(o: PanelOverride): PanelOverride {
  return o;
}
