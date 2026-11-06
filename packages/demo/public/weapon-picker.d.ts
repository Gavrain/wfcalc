export interface WeaponGroupDef {
  id: string;
  label: string;
  files: string[];
  enabled: boolean;
}

export interface PickedWeapon {
  id: string;
  name: string;
  nameZh?: string;
  category?: string;
  modes?: { id?: string; trigger?: string; [k: string]: unknown }[];
  [k: string]: unknown;
}

export interface WeaponTypeBucket {
  label: string;
  weapons: PickedWeapon[];
}

export interface WeaponGroupBucket extends WeaponGroupDef {
  types: Map<string, WeaponTypeBucket>;
}

export declare const WEAPON_GROUPS: WeaponGroupDef[];
export declare function classifyWeapon(slotEntry: unknown): {
  broad: string;
  typeKey: string;
  groupLabel: string;
  typeLabel: string;
};
export declare function groupWeapons(
  weapons: PickedWeapon[],
  slotFile: { weapons: Record<string, unknown> },
): Map<string, WeaponGroupBucket>;
export interface FireStyleOption {
  id: string;
  label: string;
}

export declare const FIRE_STYLE_OPTIONS: FireStyleOption[];
export declare function weaponMatchesStyle(weapon: { modes?: { trigger?: string }[] }, styleId: string): boolean;
export declare function filterByStyle(weapons: PickedWeapon[], styleId: string): PickedWeapon[];
export declare function searchWeapons(weapons: PickedWeapon[], keyword: unknown): PickedWeapon[];
