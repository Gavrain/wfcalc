/**
 * 鏀诲嚮妯″紡涓庝激瀹虫妯″瀷銆? *
 * 鏉ユ簮锛氬畼鏂瑰鍑?`ExportWeapons.json` 鐨?`behaviours[]`銆? * 姣忎釜 behaviour 鏄竴涓?鏀诲嚮妯″紡"锛屽叾涓寘鍚渶澶?4 绫讳激瀹虫锛? *
 *   impact          鍛戒腑锛堝瓙寮圭洿鎺ュ懡涓洰鏍囩殑浼ゅ锛? *   attack          椋炶浣撳懡涓紙鎶曞皠鐗╅鍒扮洰鏍囧悗缁撶畻鐨勪激瀹筹級
 *   explosiveAttack 鐖嗙偢锛圓oE锛岄渶瑕佸崐寰?+ 璺濈琛板噺锛岃 docs 涓?data-todo锛? *   embedDeathAttack 宓屽叆/婊炵暀鍚庢浜★紙濡?Gorgon 鐨勮搫鍔涚垎鐐革級
 *
 * 杩?4 绫绘瀵广€屽閲嶃€嶃€屽厓绱犮€嶃€屾毚鍑汇€嶇殑鍝嶅簲**骞朵笉鐩稿悓**锛屽繀椤诲垎寮€寤烘ā锛? * 涓嶈兘鍘嬪钩鎴愬崟涓€浼ゅ鏁扮粍鈥斺€旇 research/01-鏁版嵁婧愬彲琛屾€ч獙璇?md 绗?3 鑺傘€? */
import type { DamageSpread } from './damage-types.ts';

/** 瀹樻柟瀵煎嚭鐨勮Е鍙戞柟寮忥紙stateName锛夊幓鎺夎瑷€璺緞鍚庣殑鐭悕 */
export type TriggerKind = 'auto' | 'semi' | 'burst' | 'charge' | 'held' | 'active' | 'unknown';

export type SegmentKind = 'impact' | 'attack' | 'explosiveAttack' | 'embedDeathAttack';

/** 鐢ㄤ簬鎶?AoE 娈靛綊绫诲埌"闇€瑕佸崐寰勪笌琛板噺鍙傛暟"鐨勬竻鍗?*/
export const AOE_SEGMENT_KINDS: readonly SegmentKind[] = ['explosiveAttack'];

export interface DamageSegment {
  kind: SegmentKind;
  /** 璇ユ鐨勪激瀹冲垎甯冿紙瀹樻柟瀵煎嚭閲屽凡甯?procChance锛?*/
  damage: DamageSpread;
  /** 璇ユ鑷韩鐨勮Е鍙戝嚑鐜囷紙瀹樻柟瀵煎嚭閲屾瘡涓鍗曠嫭缁欙級 */
  procChance: number;
  /**
   * 璇ユ鏄惁浜х敓鑼冨洿浼ゅ銆?   * true 鏃跺崐寰勪笌琛板噺鍙傛暟鏉ヨ嚜浜哄伐缁存姢灞傦紙data/manual/aoe.ts锛夛紝缂哄け鏃惰緭鍑哄憡璀︺€?   */
  isAoe: boolean;
}

export interface AttackMode {
  /** 绋冲畾 id锛岀敤浜庨厤缃柟妗堝紩鐢紱寤鸿褰㈠ `primary` / `alt` / `charged` / `incarnon` */
  id: string;
  /** 瀹樻柟瀵煎嚭缁欏嚭鐨?stateName 鐭悕 */
  trigger: TriggerKind;
  /** 璇ユ鐨勫脊澶存暟锛坒ireIterations锛?*/
  bullets: number;
  /** 澶氶噸鍩烘暟锛堥《灞?multishot锛涗笌 bullets 鍙兘涓嶅悓锛岃 PoC 绗?3 鑺傦級 */
  baseMultishot: number;
  /** 鐐瑰皠 */
  burst?: { count: number; delay: number };
  segments: DamageSegment[];
  /** 瀹樻柟瀵煎嚭鐨勫師濮嬮敭璺緞锛屼究浜庤拷韪笌 debug */
  sourceKey?: string;
}

export interface WeaponPanel {
  /** 鍐呴儴绋冲畾 id锛堝畼鏂瑰鍑洪敭璺緞鐨勬渶鍚庝竴娈碉級 */
  id: string;
  name: { en: string; zh?: string };
  category: 'primary' | 'secondary' | 'melee' | 'archgun' | 'archmelee' | 'companion' | 'unknown';
  critChance: number;
  critMultiplier: number;
  statusChance: number;
  fireRate: number;
  magazineSize?: number;
  reloadTime?: number;
  /** 澶嶅悎/鍩虹鍏冪礌浠ュ鐨勬墍鏈夐潰鏉挎暟鎹兘鏀舵暃鍦ㄨ繖閲岋紝渚夸簬"鑷畾涔夋鍣ㄩ潰鏉?澶嶇敤鍚屼竴缁撴瀯 */
  modes: AttackMode[];
  /** 杩戞垬涓撴湁 */
  melee?: {
    range: number;
    followThrough: number;
    comboDuration: number;
    slamAttack: number;
    slamRadialDamage: number;
    slamRadius: number;
    slideAttack: number;
    heavyAttackDamage: number;
    heavySlamAttack: number;
    heavySlamRadialDamage: number;
    heavySlamRadius: number;
  };
}
