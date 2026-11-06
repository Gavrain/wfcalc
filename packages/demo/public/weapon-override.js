/**
 * 武器 override 合并规则（D-046 / D-050 / D-080）。
 *
 * 从 `app.js` 抽出来（D-103）：
 *  - 页面加载时把 `packages/data/src/manual/weapon-overrides.json` 合进武器数据；
 *  - `verify-override-merge.mjs` 是**纯逻辑**测试，原来靠正则从 `app.js` 里抠函数体，
 *    `app.js` 一改结构就红。现在两边导入同一个模块，测试即真实实现。
 *
 * 只用浏览器也能跑的语法（无 Node API、无 `.ts`），由 demo 服务器直接发出去。
 */

/** 允许通过 override 写的武器级字段（其余一律忽略） */
export const OVERRIDE_WEAPON_FIELDS = ['critChance', 'critMultiplier', 'statusChance', 'fireRate', 'magazineSize', 'reloadTime'];

/** 当前模式内的全部伤害段（D-080：段只属于变体，这里按变体顺序摊平） */
export function modeSegments(m) {
  if (!m) return [];
  const out = [];
  for (const v of m.variants || []) for (const s of v.segments || []) out.push(s);
  return out;
}

/**
 * 把一份 override 合进武器（**原地修改** `weapon`，调用方应传深拷贝）。
 *
 * 规则：
 *  ① 武器级数值：只覆盖 `OVERRIDE_WEAPON_FIELDS` 里且是有限数的字段；
 *  ② 模式：**按 id 匹配**，不按下标；
 *  ③ 模式级面板 override（D-050）：同一批字段，非法值忽略；
 *  ④ 分段：按下标覆盖，`damage` 整体替换（这样"删除某伤害类型"才生效）；
 *     模式上的 `procChance` 同步到该模式的全部段（D-048）。
 *
 * @returns 同一个 `weapon`（方便链式使用）
 */
export function mergeWeaponOverride(weapon, ov) {
  if (!ov) return weapon;

  // ① 武器级数值：标量覆盖
  for (let i = 0; i < OVERRIDE_WEAPON_FIELDS.length; i++) {
    const k = OVERRIDE_WEAPON_FIELDS[i];
    if (ov[k] !== undefined && Number.isFinite(ov[k])) weapon[k] = ov[k];
  }

  // ② 模式：按 id 匹配
  if (Array.isArray(ov.modes)) {
    for (let i = 0; i < ov.modes.length; i++) {
      const om = ov.modes[i];
      if (!om || typeof om.id !== 'string') continue;
      const target = weapon.modes.find(function (m) { return m.id === om.id; });
      if (!target) {
        console.warn('override 里的模式「' + om.id + '」在武器数据中不存在，已忽略');
        continue;
      }
      // trigger / role
      if (typeof om.trigger === 'string') target.trigger = om.trigger;
      if (typeof om.role === 'string') target.role = om.role;

      // D-050：模式级面板覆盖（只接受有限数值，非法值忽略）
      if (om.override && typeof om.override === 'object') {
        const clean = {};
        for (const [k, v] of Object.entries(om.override)) {
          if (!OVERRIDE_WEAPON_FIELDS.includes(k)) continue;
          if (typeof v === 'number' && Number.isFinite(v)) clean[k] = v;
        }
        target.override = Object.keys(clean).length ? clean : undefined;
      }

      // ③ 分段：按下标覆盖（D-080：段在变体内，用 modeSegments 摊平后按下标对齐）
      if (Array.isArray(om.segments) && modeSegments(target).length) {
        const tSegs = modeSegments(target);
        if (om.segments.length !== tSegs.length) {
          console.warn('模式「' + om.id + '」的分段数量不一致（override ' + om.segments.length +
            ' / 原 ' + tSegs.length + '），按 override 为准');
        }
        for (let s = 0; s < om.segments.length && s < tSegs.length; s++) {
          const os = om.segments[s];
          const ts = tSegs[s];
          if (!os || !ts) continue;
          if (Number.isFinite(os.procChance)) ts.procChance = os.procChance;
          // damage 整体替换（支持"删除某伤害类型"）
          if (os.damage && typeof os.damage === 'object') {
            const damage = {};
            for (const [t, v] of Object.entries(os.damage)) {
              damage[t] = Number.isFinite(v) && v >= 0 ? v : 0;
            }
            ts.damage = damage;
          }
        }
      }
      // 若 override 只给了模式的 procChance（编辑器这么存），把它同步到所有分段
      if (Number.isFinite(om.procChance)) {
        const ts2 = modeSegments(target);
        for (let s = 0; s < ts2.length; s++) {
          ts2[s].procChance = om.procChance;
        }
      }
    }
  }
  return weapon;
}
