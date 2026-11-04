/**
 * 涔樺尯锛坆ucket锛夊畾涔夈€? *
 * 璁捐鍘熷垯锛?*姣忎釜灞炴€ф槑纭睘浜庡敮涓€涓€涓箻鍖?*锛屼箻鍖哄唴閮ㄧ浉鍔犮€佷箻鍖轰箣闂寸浉涔樸€? * 杩欐槸妯℃嫙鍣ㄨ兘缁欏嚭"姣忎釜涔樺尯璐＄尞澶氬皯"鐨勫熀纭€锛屼篃鏄槻姝?Mod 鏁板€奸敊閰嶇殑鍏抽敭銆? *
 * 娉ㄦ剰锛氳繖寮犺〃鍙槸缁撴瀯楠ㄦ灦锛屽叿浣撴瘡涓睘鎬х殑褰掑睘涓庣浉浜掑奖鍝嶏紝
 * 閫氳繃 `docs/` 涓嬬殑涔樺尯褰掑睘琛ㄩ€愭潯纭鍚庡啓鍏ワ紙褰撳墠涓哄緟纭鐘舵€侊級銆? */
import type { DamageType } from './damage-types.ts';

/** 闈㈡澘涓婁竴涓彲琚?Mod 褰卞搷鐨勫睘鎬?*/
export type WeaponStat =
  | 'baseDamage'
  | 'multishot'
  | 'critChance'
  | 'critMultiplier'
  | 'statusChance'
  | 'fireRate'
  | 'reloadSpeed'
  | 'magazine'
  | 'range'
  | 'comboDuration'
  | 'projectileSpeed'
  | 'punchThrough'
  | 'ammoMax'
  | 'zoom'
  | 'factionDamage'
  | `elemental:${DamageType}`
  | `physical:${DamageType}`;

/** 涔樺尯 id锛氫笌璧勬枡閲岀殑鍒嗙被鍙ｅ緞涓€鑷达紝渚夸簬瀵圭収 */
export type BucketId =
  | 'baseDamage'   // 鍩轰激锛堝惈澶氶噸骞跺垪鐨?鍔犳硶"绫伙級
  | 'multishot'
  | 'elemental'
  | 'physical'
  | 'critChance'
  | 'critMultiplier'
  | 'statusChance'
  | 'faction'
  | 'fireRate'
  | 'utility';     // 鎹㈠脊銆佸脊鑽€佺┛閫忋€佸皠绋嬬瓑涓嶅奖鍝嶅崟鍙戜激瀹崇殑閮ㄥ垎

/** 涓€涓?Mod / 璧嬭兘 / 绱崱璇嶆潯 / 鑷畾涔夊姞鎴愭彁渚涚殑鍔犳垚 */
export interface StatContribution {
  stat: WeaponStat;
  /** 鍗曚綅锛氱櫨鍒嗘瘮锛?50% 璁颁负 50锛?*/
  percent: number;
  /** 鏉ユ簮鏍囪瘑锛岀敤浜庢媶瑙ｅ睍绀?*/
  source: string;
}

/** 涓€涓箻鍖哄湪鏌愭璁＄畻涓殑绱姞缁撴灉锛屼緵 UI 鎷嗚В灞曠ず */
export interface BucketAccumulation {
  bucket: BucketId;
  /** 鍔犳硶绱姞鍜岋紙鐧惧垎姣旓級 */
  additivePercent: number;
  /** 鏈€缁堝€嶇巼 = 1 + additivePercent / 100 */
  multiplier: number;
  contributions: StatContribution[];
}
