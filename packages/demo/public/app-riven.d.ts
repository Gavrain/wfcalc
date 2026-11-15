/**
 * `app-riven.js` 的类型声明（D-162）。
 *
 * 实现是纯 JS（浏览器直接跑），类型只在这里描述，供 typecheck 使用。
 */
import type { Contribution } from '../../core/src/contributions.ts';
import type {
  RivenCombo,
  RivenComboId,
  RivenScope,
  RivenStatDef,
  RivenStatTable,
} from '../../data/src/manual/riven.ts';

/** 一条已选词条：`key` 指向词条定义，`value` 是**用户实际那件的值**（百分比口径，派系同样是百分比） */
export interface RivenEntry {
  key: string;
  /** 百分比口径的原始值（正面为正、负面按幅度存正数） */
  value: number;
}

/** 一张裂罅 */
export interface RivenState {
  combo: RivenComboId;
  entries: RivenEntry[];
  /** 换组合时被暂时收起的词条（切回条数更多的组合会拿回来） */
  overflow?: RivenEntry[];
}

export type RivenValueMode = 'min' | 'avg' | 'max';

export function rivenScopeOf(): RivenScope | null;
export function rivenTableNow(): RivenStatTable | null;
export function currentRiven(): RivenState | null;
export function rivenInstalledSlot(): number;
export function isRivenInstalled(): boolean;
export function rivenDefOf(table: RivenStatTable, key: string): RivenStatDef | null;
export function rivenComboNow(): RivenCombo;
export function rivenSlotKind(index: number): 'pos' | 'neg';
export function rivenSlotCount(): number;
export function rivenFilledCount(): number;
export function rivenValueModeNow(): RivenValueMode;
export function rivenValueFor(def: RivenStatDef, kind: 'pos' | 'neg', value?: number): number;
export function rivenRawValueFor(def: RivenStatDef, kind: 'pos' | 'neg'): number;
export function rivenRawRange(def: RivenStatDef, kind: 'pos' | 'neg'): { avg: number; min: number; max: number };
export function formatRivenValue(def: RivenStatDef, kind: 'pos' | 'neg', amplitude: number, withMark?: boolean): string;
export function recoilSign(kind: 'pos' | 'neg'): number;
export function rivenSliderScale(def: RivenStatDef, kind: 'pos' | 'neg'): { toSlider(amp: number): number; toAmp(v: number): number };
export function formatRivenValue(def: RivenStatDef, kind: 'pos' | 'neg', display: number): string;
export function formatRivenRange(def: RivenStatDef, kind: 'pos' | 'neg'): string;
export function resetRiven(combo?: RivenComboId): RivenState;
export function ensureRiven(): RivenState;
export function setRivenCombo(id: RivenComboId): void;
export function setRivenEntry(index: number, key: string): void;
export function placeRivenEntry(index: number, key: string, from?: number): void;
export function setRivenEntryValue(index: number, value: number): void;
export function applyRivenValueMode(): void;
export function rivenToContributions(slot?: number): Contribution[];
export function previewWithEntry(index: number, key: string, slot?: number): Contribution[];
