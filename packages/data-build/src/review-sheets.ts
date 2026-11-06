/**
 * 生成 @wfcd/items 补缺的**人工复核表**（D-069 C 方案）。
 *
 * 只读：读 generated/weapons + .cache 里解包的 @wfcd/items，写文件到 data-todo/。
 * 不写 generated/，不改 manual/，不跑流水线。
 *
 * 用法：
 *   node --experimental-strip-types packages/data-build/src/review-sheets.ts
 *
 * 原则（2026-11-06 需求方要求：**没问题的不要出现**）：
 *   1. 对位按**伤害内容**（同模式同类型合并 + WFCD 重复计数去重 + 金额 1% 容差），不按下标。
 *   2. 已确定的一律不进表：aoefalloff 的 start/end/reduction 写进 aoe-falloff.auto.json。
 *   3. CSV 只列**边界规则覆盖不到**的行。
 *
 * 产出：
 *   data-todo/aoe-falloff.auto.json  AoE 衰减（自动解析，已确定）
 *   data-todo/wfcd-confirm.csv       待确认：AoE 半径无法推断 / 爆炸段对不上 / 面板数值冲突
 */
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { AttackMode } from '../../core/src/weapon.ts';

const repoRoot = resolve(import.meta.dirname, '../../..');
const WEAPON_DIR = join(repoRoot, 'packages/data/src/generated/weapons');
const WFCD_DIR = join(repoRoot, '.cache/wfcd-items-pkg/package/data/json');
const OUT_DIR = join(repoRoot, 'data-todo');

const CATEGORIES = ['primary', 'secondary', 'melee', 'archgun', 'archmelee', 'companion'] as const;
const WFCD_FILES = ['Primary', 'Secondary', 'Melee', 'Arch-Gun', 'Arch-Melee', 'SentinelWeapons'];

// ── 类型 ────────────────────────────────────────────────────
interface Seg {
  kind: string;
  aoe: boolean;
  damage: Record<string, number>;
  procChance: number;
}
interface Mode {
  id: string;
  role: string;
  trigger: string;
  override?: {
    critChance?: number;
    critMultiplier?: number;
    statusChance?: number;
    fireRate?: number;
    magazineSize?: number;
    reloadTime?: number;
  };
  /** D-080：段只属于变体，模式上已无 segments */
  variants: Variant[];
}
interface Variant {
  id: string;
  label: string;
  segments: Seg[];
  override?: Record<string, number>;
}
interface Weapon {
  id: string;
  name: string;
  nameZh?: string;
  critChance: number;
  critMultiplier: number;
  statusChance: number;
  fireRate: number;
  modes: Mode[];
}
interface WfcdAttack {
  name: string;
  speed?: number;
  crit_chance?: number;
  crit_mult?: number;
  status_chance?: number;
  shot_type?: string;
  falloff?: { start: number; end: number; reduction?: number };
  damage: Record<string, number>;
}
interface WfcdWeapon {
  uniqueName: string;
  attacks?: WfcdAttack[];
}
type Row = (string | number)[];

// ── CSV ─────────────────────────────────────────────────────
function csvCell(v: unknown): string {
  const s = v === undefined || v === null ? '' : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function writeCsv(path: string, header: readonly string[], rows: Row[]): void {
  const text = [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, text, 'utf8');
  try {
    renameSync(tmp, path);
    console.log(`  写入 ${path}（${rows.length} 行）`);
  } catch {
    console.log(`  ⚠ ${path} 被占用（Excel 打开中）→ 已写入 ${tmp}`);
  }
}

const nz = (d: Record<string, number>): Record<string, number> =>
  Object.fromEntries(Object.entries(d).filter(([, v]) => v > 0));
const fmtSpread = (d: Record<string, number>): string =>
  Object.entries(nz(d))
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k} ${+v.toFixed(2)}`)
    .join(' + ');
const sumSpread = (d: Record<string, number>): number => Object.values(nz(d)).reduce((a, b) => a + b, 0);

function sameSpread(a: Record<string, number>, b: Record<string, number>): boolean {
  const ka = Object.keys(nz(a)).sort();
  const kb = Object.keys(nz(b)).sort();
  if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false;
  for (const k of ka) {
    const x = a[k]!;
    const y = b[k]!;
    if (Math.abs(x - y) > Math.max(1, Math.max(x, y) * 0.01)) return false;
  }
  return true;
}

// ── 加载 ────────────────────────────────────────────────────
function loadWfcd(): Record<string, WfcdWeapon> {
  if (!existsSync(WFCD_DIR)) {
    throw new Error(`找不到解包后的 @wfcd/items：${WFCD_DIR}\n先从 npm 取包再解包，见 research/04 第 5 节`);
  }
  const out: Record<string, WfcdWeapon> = {};
  for (const f of WFCD_FILES) {
    const list = JSON.parse(readFileSync(join(WFCD_DIR, `${f}.json`), 'utf8')) as WfcdWeapon[];
    for (const w of list) out[w.uniqueName.split('/').pop() ?? w.uniqueName] = w;
  }
  return out;
}
function loadLocal(): Weapon[] {
  const out: Weapon[] = [];
  for (const c of CATEGORIES) {
    const path = join(WEAPON_DIR, `${c}.json`);
    if (!existsSync(path)) continue;
    const body = JSON.parse(readFileSync(path, 'utf8')) as { weapons?: Weapon[] };
    for (const w of body.weapons ?? []) out.push(w);
  }
  return out;
}

// ── 匹配 ────────────────────────────────────────────────────
interface LocalBlock {
  spread: Record<string, number>;
  parts: { seg: Seg; index: number; segNo: number }[];
}
/** D-080：把模式内所有变体的段摊平 */
function segsOf(m: Mode): Seg[] {
  const out: Seg[] = [];
  for (const v of m.variants ?? []) for (const s of v.segments ?? []) out.push(s);
  return out;
}

/** 同一模式内同 kind 的 AoE 段合并成一个块 */
function localBlocks(m: Mode): LocalBlock[] {
  const byKind = new Map<string, LocalBlock>();
  let segNo = 0;
  // D-080：段在变体内，这里摊平后按序处理
  segsOf(m).forEach((seg, index) => {
    if (!seg.aoe) return;
    segNo++;
    let block = byKind.get(seg.kind);
    if (!block) {
      block = { spread: {}, parts: [] };
      byKind.set(seg.kind, block);
    }
    const flat: Seg = { kind: seg.kind, aoe: seg.aoe, damage: Object.fromEntries(Object.entries(seg.damage).filter(([, v]) => typeof v === 'number')) as Record<string, number>, procChance: seg.procChance };
    for (const [t, v] of Object.entries(flat.damage) as [string, number][]) {
      block.spread[t] = (block.spread[t] ?? 0) + v;
    }
    block.parts.push({ seg: flat, index, segNo });
  });
  return [...byKind.values()];
}
/** 伤害相同且"是否 AoE"相同 → 重复计数，只留一条 */
function dedupe(attacks: WfcdAttack[]): WfcdAttack[] {
  const kept: WfcdAttack[] = [];
  for (const a of attacks) {
    if (!kept.some((k) => sameSpread(k.damage, a.damage) && (k.shot_type === 'AoE') === (a.shot_type === 'AoE'))) {
      kept.push(a);
    }
  }
  return kept;
}
function findMatch(block: LocalBlock, attacks: WfcdAttack[]): WfcdAttack | undefined {
  const tgt = sumSpread(block.spread);
  return attacks
    .filter((a) => sameSpread(a.damage, block.spread))
    .sort((x, y) => Math.abs(sumSpread(x.damage) - tgt) - Math.abs(sumSpread(y.damage) - tgt))[0];
}

const weaponLabel = (w: Weapon): string => (w.nameZh ? `${w.nameZh} ${w.name}` : w.name);

// ── 1. AoE 衰减 ─────────────────────────────────────────────
/**
 * 需求方确认的两种衰减模型（D-070，2026-11-06 第五轮）——**只做面板展示，不进伤害计算**：
 *
 *   甲 · 爆炸：只有一个范围 `radius`，从爆炸中心到半径线性衰减到边缘。
 *   乙 · 霰弹：两段。`[0, falloffStart]` 全伤害 → `[falloffStart, falloffEnd]` 线性下降
 *             → `falloffEnd` 之外保持边缘值不变。
 *
 * WFCD 用同一套 `{start, end, reduction}` 描述两种模型，**仅凭数据分不出甲还是乙**。
 * 这里采用一条可复核的判据（需要人复核的部分会进 CSV）：
 *
 *   · 本地段是 `embedDeathAttack`（炮弹嵌进目标后爆开）→ 甲；
 *   · `falloff.start ≥ falloff.end` 或 `start = 0` → start 不构成"全伤害区"→ 甲，且
 *     `radius = end`（*不可靠判据：按需求方的霰弹模型，start 应当 > 0，
 *     所以 start = 0 更可能是"没填"而不是"全射程满伤"*）；
 *   · 否则 → 乙，`falloffStart = start`、`falloffEnd = end`。
 *
 * 两种模型的数值都取自 WFCD，`edge_multiplier = 1 − reduction`（需求方批注确认）。
 */
type FalloffModel = 'explosion' | 'shotgun';

interface FalloffValue {
  model: FalloffModel;
  radius?: number;
  falloffStart?: number;
  falloffEnd?: number;
  edgeMultiplier: number;
  wfcdName: string;
}

/** 判定 + 取值；判据不可靠时同时给出理由，供 CSV 复核 */
function classifyFalloff(
  kind: string,
  attack: WfcdAttack,
): { value: FalloffValue | null; doubt?: string } {
  const f = attack.falloff;
  if (!f || f.reduction === 0) return { value: null };
  if (f.reduction === undefined) return { value: null, doubt: 'WFCD 的 start/end 不全' };

  const edge = +(1 - f.reduction).toFixed(4);
  // 炮弹嵌入后爆开：只能是爆炸模型
  if (kind === 'embedDeathAttack') {
    return {
      value: { model: 'explosion', radius: f.end, edgeMultiplier: edge, wfcdName: attack.name },
    };
  }
  // start 不构成"全伤害区"→ 爆炸模型
  if (f.start >= f.end || f.start === 0) {
    return {
      value: { model: 'explosion', radius: f.end, edgeMultiplier: edge, wfcdName: attack.name },
      doubt: `按霰弹模型 start 应当 > 0，此处 start = ${f.start}，已按爆炸模型取 radius = ${f.end}`,
    };
  }
  // 否则按霰弹的两段衰减
  return {
    value: {
      model: 'shotgun',
      falloffStart: f.start,
      falloffEnd: f.end,
      edgeMultiplier: edge,
      wfcdName: attack.name,
    },
  };
}

function resolveAoe(weapons: Weapon[], wfcd: Record<string, WfcdWeapon>): {
  auto: Record<string, unknown>;
  confirm: Row[];
  stats: { resolved: number; none: number; explosion: number; shotgun: number; doubtful: number };
} {
  const auto: Record<string, unknown> = {};
  const confirm: Row[] = [];
  const stats = { resolved: 0, none: 0, explosion: 0, shotgun: 0, doubtful: 0 };
  /** 同一发爆炸的两个段合并成一行 */
  const seen = new Map<string, { row: Row; kinds: string[] }>();

  for (const w of weapons) {
    const W = wfcd[w.id];
    if (!W) continue;
    const pool = dedupe((W.attacks ?? []).filter((a) => a.shot_type === 'AoE'));

    for (const m of w.modes) {
      for (const block of localBlocks(m)) {
        const attack = findMatch(block, pool);
        if (!attack) continue;
        const kind = block.parts[0]!.seg.kind;
        const { value, doubt } = classifyFalloff(kind, attack);
        const rep = `${attack.name}（falloff ${attack.falloff ? `${attack.falloff.start}~${attack.falloff.end}` : '无'} reduction ${attack.falloff?.reduction ?? '-'}）`;

        // 写进自动结果
        for (const p of block.parts) {
          auto[`${w.id}/${m.id}/${kind}/#${p.segNo}`] = { resolved: true, ...(value ?? { falloff: null }) };
        }
        if (!value) {
          stats.none++;
          continue;
        }
        stats[value.model]++;
        stats.resolved++;

        // 判据不可靠的进 CSV 让人复核
        if (doubt) {
          stats.doubtful++;
          const dedupKey = `${w.id}|${m.id}|${kind}`;
          const prev = seen.get(dedupKey);
          if (prev) {
            prev.kinds.push(kind);
            continue;
          }
          const row: Row = [
            '衰减模型',
            `${w.id}/${m.id}/${kind}`,
            weaponLabel(w),
            m.id,
            `本地 ${kind}：${fmtSpread(block.spread)}`,
            rep,
            '',
            'explosion 或 shotgun',
            `${doubt}；填 explosion（只有半径）或 shotgun（两段衰减）`,
          ];
          seen.set(dedupKey, { row, kinds: [kind] });
          confirm.push(row);
        }
      }
    }
  }
  return { auto, confirm, stats };
}

// ── 2. 灵化 / 多模式面板 ────────────────────────────────────
/**
 * 只列**同伤害攻击给出不同面板**的情况（即"WFCD 自己都说这个模式有两种值"），
 * 以及本地 `role=incarnon` 但**找不到灵化攻击**的（WFCD 缺数据）。
 *
 * 不列：普通模式（WFCD 只有一条攻击）、面板与本地一致的模式——那些没争议。
 */
function panelRows(weapons: Weapon[], wfcd: Record<string, WfcdWeapon>): Row[] {
  const rows: Row[] = [];
  for (const w of weapons) {
    const attacks = wfcd[w.id]?.attacks ?? [];
    for (const m of w.modes) {
      const spread: Record<string, number> = {};
      for (const s of segsOf(m)) for (const [t, v] of Object.entries(s.damage) as [string, number][]) spread[t] = (spread[t] ?? 0) + v;
      if (sumSpread(spread) <= 0) continue;

      const content = dedupe(attacks).filter((a) => sameSpread(a.damage, spread));
      // 同一条伤害在 WFCD 里对应多条攻击，且面板不同 → 该模式的面板有歧义
      const distinct = new Map<string, WfcdAttack>();
      for (const a of content) {
        const key = `${a.crit_chance}/${a.crit_mult}/${a.status_chance}`;
        if (!distinct.has(key)) distinct.set(key, a);
      }
      if (distinct.size > 1) {
        const list = [...distinct.values()]
          .map((a) => `${a.name}：${a.crit_chance ?? '-'}% / ${a.crit_mult ?? '-'} / ${a.status_chance ?? '-'}%`)
          .join('；');
        rows.push([
          '面板冲突', `${w.id}/${m.id}`, weaponLabel(w), m.id,
          `${m.override?.critChance ?? w.critChance} / ${m.override?.critMultiplier ?? w.critMultiplier} / ${m.override?.statusChance ?? w.statusChance}`,
          list, 'panel_value', '', '同一伤害有多个不同面板，请填写该模式真实的 暴率/暴伤/触发',
        ]);
        continue;
      }

      // 本地认定是灵化，但 WFCD 没有灵化攻击 → 无参考数据
      if (m.role === 'incarnon' && !attacks.some((a) => /Incarnon/i.test(a.name) && sameSpread(a.damage, spread))) {
        rows.push([
          '灵化缺数据', `${w.id}/${m.id}`, weaponLabel(w), m.id,
          `${m.override?.critChance ?? w.critChance} / ${m.override?.critMultiplier ?? w.critMultiplier} / ${m.override?.statusChance ?? w.statusChance}`,
          'WFCD 无对应的灵化攻击', 'panel_value', '', 'WFCD 没这条数据，若有实测值请填写（概率 0~1）',
        ]);
      }
    }
  }
  return rows;
}

// ── main ────────────────────────────────────────────────────
mkdirSync(OUT_DIR, { recursive: true });
const weapons = loadLocal();
const wfcd = loadWfcd();
console.log(`本地武器 ${weapons.length} 把；WFCD 索引 ${Object.keys(wfcd).length} 条`);

console.log('\n[1/2] 衰减（两种模型）');
const aoe = resolveAoe(weapons, wfcd);
console.log(
  `  已定 ${aoe.stats.resolved} 段（爆炸 ${aoe.stats.explosion} / 霰弹 ${aoe.stats.shotgun}）/ 不衰减 ${aoe.stats.none} 段 / ` +
    `模型判据待复核 ${aoe.stats.doubtful} 段`,
);
writeFileSync(
  join(OUT_DIR, 'aoe-falloff.auto.json'),
  JSON.stringify(
    {
      source: 'wfcd@1.1276.47 attacks[].falloff',
      note: '只用于面板展示，不参与伤害计算（D-070）。explosion = 单一半径、由中心线性衰减；shotgun = 两段（start 内全伤害、start~end 线性降、end 外保持边缘值）',
      resolved: aoe.auto,
    },
    null,
    2,
  ) + '\n',
  'utf8',
);
console.log(`  写入 data-todo/aoe-falloff.auto.json（${Object.keys(aoe.auto).length} 段）`);

console.log('\n[2/2] 面板');
const panels = panelRows(weapons, wfcd);
console.log(`  需确认 ${panels.length} 行`);

writeCsv(
  join(OUT_DIR, 'wfcd-confirm.csv'),
  ['类别', 'row_key', '武器', '模式', '本地现值', 'WFCD 参考', '要填的列', '填写', '说明'] as const,
  [...panels, ...aoe.confirm],
);
console.log('\n完成');
