/**
 * 武器赋能清洗：把官方 `ExportArcanes.json` 的模板串拆成结构化数据。
 *
 * 官方赋能数据长这样（每一级一个模板）：
 *   { tag: "/Lotus/Language/Arcanes/PrimaryDamageOnKillDesc",
 *     sub: { CONDITION: "...Condition_Description", BONUS: { tag: "...WeaponDamageModDesc",
 *            sub: { val: "+30" } }, DURATION: "6" } }
 *
 * 拆解思路：
 *   1. 用语言包把模板渲染成可读文本（中英文各一份），存进 `description`
 *   2. 递归把 `sub` 里**所有数值字符串**收集成 { 路径: 数值 }，逐级对比得到 `levels`
 *   3. 用"满级渲染文本 + 名称前缀"判断它影响哪个乘区、能不能进伤害计算
 *
 * 范围（需求方确认 2026-11-05）：
 *   · 收录：主要· / 次要· / 近战· / 神威· / 和平· / 残差· / 弓箭· / 霰弹· / 双枪· / 瀑流· / 联结· / 分形·
 *   · 排除：战甲赋能（`赋能·` 前缀，装在战甲上）、只加护甲/护盾/能量/宠物等不影响武器伤害的
 */
import type { BucketId } from '../../../core/src/buckets.ts';

export type ArcaneCategory =
  | 'primary' // 主要·
  | 'secondary' // 次要·/ 瀑流·/ 联结·/ 双枪·/ 弓箭·/ 霰弹·/ 分形·
  | 'melee' // 近战·/ 神威·
  | 'kitgun'; // 和平·/ 残差·

/** 一条赋能在伤害计算里的作用方式 */
export type ArcaneEffectKind =
  | 'damageBuff' // 直接给伤害% 加成
  | 'crit' // 暴击相关
  | 'multishot'
  | 'status' // 触发率 / 异常状态
  | 'elemental' // 给武器附加元素
  | 'dotAmplifier' // 放大 DoT
  | 'combo' // 连击相关
  | 'special' // 特殊机制（投射物、爆头加成、复制攻击等）
  | 'utility' // 手感类（装填/弹药/后坐）
  | 'nonDamage'; // 只加护甲/护盾/能量/宠物 → 不收录

export interface ArcaneLevel {
  /** 等级（0 = 一级，maxRank 为满级） */
  rank: number;
  /** 这一级所有数值槽：路径 → 数值（已转成 number） */
  values: Record<string, number>;
}

export interface CleanArcane {
  id: string;
  /** 官方内部键（如 PrimaryDamageOnKill） */
  key: string;
  name: { en: string; zh: string };
  category: ArcaneCategory;
  /** 名称前缀，用来说明它装在哪种武器上（主要 / 次要 / 近战 / 神威 …） */
  prefix: string;
  maxRank: number;
  rarity: string;
  effectKind: ArcaneEffectKind;
  /** 落在哪个乘区；null = 不进伤害汇总 */
  bucket: BucketId | null;
  /** 满级中文描述（模板渲染结果） */
  description: { en: string; zh: string };
  levels: ArcaneLevel[];
}

/** 收录的名称前缀（决定它是不是"武器赋能"） */
export const WEAPON_PREFIXES = [
  '主要·',
  '次要·',
  '近战·',
  '神威·',
  '和平·',
  '残差·',
  '弓箭·',
  '霰弹·',
  '双枪·',
  '瀑流·',
  '联结·',
  '分形·',
] as const;

/** 前缀 → 大类 */
export function categoryOf(prefix: string): ArcaneCategory {
  if (prefix === '主要·') return 'primary';
  if (prefix === '近战·' || prefix === '神威·') return 'melee';
  if (prefix === '和平·' || prefix === '残差·') return 'kitgun';
  return 'secondary';
}


/** 递归收集数值槽：路径 → number。兼容"每条目是数组"和"每条目是对象"两种结构 */
export function collectValues(node: unknown, prefix = '', into: Record<string, number> = {}): Record<string, number> {
  if (Array.isArray(node)) {
    node.forEach((n, i) => collectValues(n, `${prefix}[${i}]`, into));
    return into;
  }
  if (node && typeof node === 'object') {
    const obj = node as { sub?: Record<string, unknown>; tag?: string };
    // 结构 A：{ tag, sub: { KEY: 数值或子树 } }（ExportArcanes）
    if (obj.sub && typeof obj.sub === 'object') {
      collectFromMap(obj.sub, prefix, into);
      return into;
    }
    // 结构 B：扁平的 { KEY: "数值" }（ExportModSet 的 levelStats 就是这种）
    const plain = Object.entries(obj).filter(([k]) => k !== 'tag' && k !== 'sub');
    if (plain.length > 0) collectFromMap(Object.fromEntries(plain), prefix, into);
  }
  return into;
}

/** 把一层 { KEY: 值或子树 } 摊进扁平表 */
function collectFromMap(map: Record<string, unknown>, prefix: string, into: Record<string, number>): void {
  for (const [k, v] of Object.entries(map)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'object' && v !== null) {
      collectValues(v, path, into);
    } else if (typeof v === 'string') {
      const n = parseNumber(v);
      if (n !== null) {
        into[path] = n;
        continue;
      }
      // 乘法型（x8）单独记，前缀标 x 避免与百分比混淆
      const mul = parseMultiplier(v);
      if (mul !== null) into[`${path}#x`] = mul;
    }
  }
}

/** "+30" / "1.5" / "+0.3" → number；不是数值返回 null */
export function parseNumber(s: string): number | null {
  const t = s.trim();
  if (!/^[+-]?\d+(\.\d+)?%?$/.test(t)) return null;
  const n = Number(t.replace('%', ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * 乘法型数值（`x3` / `x8` / `x2.5`）→ number。
 * 这类必须和百分比分开存，否则会被当成 "+8%" 算错。
 */
export function parseMultiplier(s: string): number | null {
  const m = /^x\s*(\d+(?:\.\d+)?)$/i.exec(s.trim());
  return m ? Number(m[1]) : null;
}

/**
 * 明确不收录的赋能（人工逐个核对过，不是靠关键字猜）。
 *
 * 理由：它们**不改变武器伤害**——只加护甲、护盾、能量、或只影响手感。
 * 其余全部收录：即使是"装填速度""弹药效率"这类，也保留在数据里，
 * 由计算内核决定要不要展示（归类为 utility，不进伤害汇总）。
 *
 * key = 官方内部键（ExportArcanes 的路径末段）
 */
export const EXCLUDED_ARCANES: Readonly<Record<string, string>> = {
  ArmorOnMeleeKill: '近战·坚壁：近战击杀 +210 护甲，只加护甲、不改武器伤害',
  ChannelKillEnergyRate: '神威·勇武：重击击杀回能量，属战甲能量层',
  EnergyEfficiencyOnHeadshot: '和平·电闪：给下一个技能加技能效率/强度，属战甲层',
  EyeInTheSky: '和平·高飞：只影响精准度/后坐力/飞身瞄准时长',
  BulletToBattery: '和平·电充：电池充电延迟，只影响弹药循环',
};

/**
 * 名字前缀 + 满级文本 → 作用方式与乘区。
 *
 * 判据顺序很重要：先剔除"不影响武器伤害"的，再看具体加成。
 */
export function classifyArcane(
  zhName: string,
  zhDesc: string,
  key = '',
): { kind: ArcaneEffectKind; bucket: BucketId | null; reason: string } {
  const d = zhDesc;

  // 0. 人工排除清单（最优先）
  if (key && Object.hasOwn(EXCLUDED_ARCANES, key)) {
    return { kind: 'nonDamage', bucket: null, reason: EXCLUDED_ARCANES[key]! };
  }

  // 1. 乘法型伤害加成（x2.5 这种要单独标，不能当百分比加）
  if (/x\s*\d+(\.\d+)?/.test(d)) {
    return { kind: 'damageBuff', bucket: null, reason: '乘法型伤害（xN），需单独按倍率处理' };
  }

  // 2. 明确不影响武器伤害的（纯辅助）
  if (/永久获得.*初始连击|连击持续时间|连击数几率|连击倍率/.test(d) && !/伤害|暴击|多重|触发/.test(d)) {
    return { kind: 'combo', bucket: null, reason: '连击相关，不影响武器命中伤害' };
  }
  if (/处决击杀时.*生命窃取|生命窃取/.test(d)) return { kind: 'nonDamage', bucket: null, reason: '只回血' };

  // 3. 具体加成归类（顺序：越具体的越先判）
  if (/多重/.test(d)) return { kind: 'multishot', bucket: 'multishot', reason: '多重射击' };
  if (/暴击伤害|暴击倍率/.test(d)) return { kind: 'crit', bucket: 'critMultiplier', reason: '暴击伤害' };
  if (/暴击几率|暴击率/.test(d)) return { kind: 'crit', bucket: 'critChance', reason: '暴击几率' };
  if (/(获得|附加|施加).*(腐蚀|冰冻|火焰|毒素|电击)伤害/.test(d)) {
    return { kind: 'elemental', bucket: 'elemental', reason: '武器附加元素伤害' };
  }
  if (/异常状态|触发几率|施加.*层/.test(d)) return { kind: 'status', bucket: 'statusChance', reason: '异常状态相关' };
  if (/投射物|冲击波|飞射物|爆炸/.test(d)) return { kind: 'special', bucket: null, reason: '产生额外攻击/投射物' };
  if (/伤害/.test(d)) return { kind: 'damageBuff', bucket: 'baseDamage', reason: '伤害加成' };
  if (/装填速度|弹药效率|充电|后坐力|精准度/.test(d)) return { kind: 'utility', bucket: null, reason: '手感类，不进伤害汇总' };
  return { kind: 'special', bucket: null, reason: '特殊机制，需人工确认乘区' };
}

/**
 * 清洗单个赋能。
 * @param key ExportArcanes 的完整路径
 * @param raw 官方条目
 * @param dictZh / dictEn 语言包
 * @returns null 表示不在收录范围（战甲赋能 / 前缀不匹配）
 */
export function cleanArcane(
  key: string,
  raw: { name?: string; rarity?: string; levelStats?: unknown[] },
  dictZh: Record<string, string>,
  dictEn: Record<string, string>,
): CleanArcane | { excluded: 'outOfScope' | 'nonDamage'; reason: string; name: string } {
  const zhName = (dictZh[raw.name ?? ''] ?? '').trim();
  const enName = (dictEn[raw.name ?? ''] ?? '').trim();
  const shortKey = key.split('/').pop() ?? key;

  const prefix = WEAPON_PREFIXES.find((p) => zhName.startsWith(p));
  if (!prefix) return { excluded: 'outOfScope', reason: '不是武器赋能（前缀不在收录范围）', name: zhName || enName };

  const ls = (raw.levelStats ?? []) as unknown[];
  if (ls.length === 0) return { excluded: 'outOfScope', reason: '没有等级数据', name: zhName };

  const descZh = renderTemplate(ls.at(-1), dictZh).replace(/\s+/g, ' ').trim();
  const descEn = renderTemplate(ls.at(-1), dictEn).replace(/\s+/g, ' ').trim();
  const cls = classifyArcane(zhName, descZh, shortKey);

  if (cls.kind === 'nonDamage') return { excluded: 'nonDamage', reason: cls.reason, name: zhName };

  const levels: ArcaneLevel[] = ls.map((lv, i) => ({ rank: i, values: collectValues(lv) }));

  return {
    id: shortKey,
    key: shortKey,
    name: { en: enName, zh: zhName },
    category: categoryOf(prefix),
    prefix,
    maxRank: Math.max(0, ls.length - 1),
    rarity: raw.rarity ?? 'UNKNOWN',
    effectKind: cls.kind,
    bucket: cls.bucket,
    description: { en: descEn, zh: descZh },
    levels,
  };
}

/** 递归渲染模板：tag 查语言包，sub 里的占位符替换成数值或嵌套文本 */
export function renderTemplate(node: unknown, dict: Record<string, string>): string {
  if (node == null) return '';
  if (typeof node === 'string') return dict[node] ?? node;
  if (Array.isArray(node)) return node.map((n) => renderTemplate(n, dict)).join('');

  // 结构 B：扁平的 { KEY: "值" }（套装），没有 tag，直接按占位符拼
  if (typeof node === 'object') {
    const obj = node as { tag?: string; sub?: Record<string, unknown> };
    if (!obj.tag) {
      const parts = Object.entries(obj).map(([k, v]) =>
        typeof v === 'object' && v !== null ? renderTemplate(v, dict) : `${k}=${String(v)}`,
      );
      return parts.join(' ');
    }

    const tpl = dict[obj.tag] ?? '';
    const sub = obj.sub ?? {};
    let out = tpl;
    const used = new Set<string>();

    for (const [k, v] of Object.entries(sub)) {
      const raw = typeof v === 'object' && v !== null ? renderTemplate(v, dict) : typeof v === 'string' ? (dict[v] ?? v) : String(v);
      for (const form of [k, k.toLowerCase(), k.toUpperCase()]) {
        const token = `|${form}|`;
        if (out.includes(token)) {
          out = out.split(token).join(raw);
          used.add(k);
          // 模板里可能带正负号，而值本身已经是 "+30"，避免出现 "++30"
          out = out.replace(/\+\s*\+/g, '+').replace(/-\s*-/g, '-');
        }
      }
    }

    // 占位符没被替换用到的关键数值（如 DURATION）附在末尾，避免丢信息
    const leftovers = Object.entries(sub)
      .filter(([k]) => !used.has(k))
      .map(([k, v]) => {
        const raw = typeof v === 'object' && v !== null ? renderTemplate(v, dict) : typeof v === 'string' ? (dict[v] ?? v) : String(v);
        // 纯语言键（包含 /）说明是描述片段而不是数值，跳过
        return typeof v === 'string' && v.includes('/') ? '' : `${k}: ${raw}`;
      })
      .filter((s) => s.trim())
      .join('，');
    if (leftovers) out = out ? `${out} (${leftovers})` : leftovers;

    return out;
  }
  return String(node);
}
