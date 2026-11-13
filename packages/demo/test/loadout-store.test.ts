/**
 * 配卡存档（D-157，需求方 2026-11-12）。
 *
 * > 「现在换武器会清空配卡，我想刷新页面的时候能保存当前配卡状态，
 * >   不然一不小心按到 f5 就要重新来了。」
 *
 * 这里只测 `app-store.js` 的读写层（纯数据、不碰 DOM）：
 *   · 存过能读回来；
 *   · 没存过的武器返回 null（调用方据此清空）；
 *   · 坏数据 / 存储不可用都不抛错；
 *   · 每把武器各存各的，互不覆盖；
 *   · 超出上限按最久没用的淘汰。
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  LOADOUT_MAX_WEAPONS, LOADOUT_STORE_KEY, clearLoadoutStore, getSavedLoadout,
  lastUiState, lastWeaponId, makeLoadoutEntry, saveLoadout,
} from '../public/app-store.js';
import type { SavedLoadout } from '../public/app-store.js';

/** 读某把武器的配卡，且断言它存在（测试里省掉空值分支） */
function must(v: SavedLoadout | null): SavedLoadout {
  assert.ok(v, '期望这里有存档，实际是 null');
  return v;
}

/** 装一个内存版 localStorage；返回内存表供断言 */
function installStorage(): Map<string, string> {
  const mem = new Map<string, string>();
  (globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
    setItem: (k: string, v: string) => { mem.set(k, String(v)); },
    removeItem: (k: string) => { mem.delete(k); },
  };
  return mem;
}

function storageGet(k: string): string | null {
  const ls = (globalThis as unknown as { localStorage: { getItem(k: string): string | null } }).localStorage;
  return ls ? ls.getItem(k) : null;
}

function storageSet(k: string, v: string): void {
  (globalThis as unknown as { localStorage: { setItem(k: string, v: string): void } }).localStorage.setItem(k, v);
}

/** 把 localStorage 换成"一访问就抛错"的隐私模式，用完恢复 */
function withBrokenStorage(fn: () => void): void {
  const g = globalThis as unknown as { localStorage?: unknown };
  const desc = Object.getOwnPropertyDescriptor(g, 'localStorage');
  Object.defineProperty(g, 'localStorage', {
    configurable: true,
    get() { throw new Error('SecurityError'); },
  });
  try {
    fn();
  } finally {
    if (desc) Object.defineProperty(g, 'localStorage', desc);
    else delete g.localStorage;
  }
}

const slots = (a: string | null, b?: string | null): (string | null)[] => {
  const out: (string | null)[] = new Array(8).fill(null);
  if (a) out[0] = a;
  if (b) out[1] = b;
  return out;
};

describe('配卡存档：存了能读回来', () => {
  beforeEach(() => { installStorage(); });

  it('存一套配卡，读回来逐项一致', () => {
    saveLoadout('KuvaKarak', makeLoadoutEntry(slots('serration', 'split_chamber'), 'exilus_a', 'arcane_x'));
    const back = must(getSavedLoadout('KuvaKarak'));
    assert.equal(back.slots[0], 'serration');
    assert.equal(back.slots[1], 'split_chamber');
    assert.equal(back.slots[7], null);
    assert.equal(back.exilus, 'exilus_a');
    assert.equal(back.arcane, 'arcane_x');
  });

  it('没存过的武器返回 null（调用方据此清空配卡）', () => {
    assert.equal(getSavedLoadout('NeverSaved'), null);
  });

  it('空配卡也照样存：读回来是"存过的空配卡"，不是 null', () => {
    saveLoadout('EmptyOne', makeLoadoutEntry([], null, null));
    const back = must(getSavedLoadout('EmptyOne'));
    assert.deepEqual(back.slots, new Array(8).fill(null));
    assert.equal(back.exilus, null);
    assert.equal(back.arcane, null);
  });
});

describe('配卡存档：按武器分开', () => {
  beforeEach(() => { installStorage(); });

  it('两把武器各存各的，互不覆盖', () => {
    saveLoadout('WeaponA', makeLoadoutEntry(slots('modA1', 'modA2'), null, null));
    saveLoadout('WeaponB', makeLoadoutEntry(slots('modB1'), null, null));
    assert.equal(must(getSavedLoadout('WeaponA')).slots[0], 'modA1');
    assert.equal(must(getSavedLoadout('WeaponB')).slots[0], 'modB1');
    assert.equal(must(getSavedLoadout('WeaponA')).slots[1], 'modA2');
    assert.equal(must(getSavedLoadout('WeaponB')).slots[1], null);
  });

  it('换到 B 之后再换回 A，A 的配卡还在', () => {
    saveLoadout('WeaponA', makeLoadoutEntry(slots('modA1'), null, null));
    saveLoadout('WeaponB', makeLoadoutEntry(slots('modB1'), null, null));
    assert.equal(must(getSavedLoadout('WeaponA')).slots[0], 'modA1');
  });

  it('记下最后用的是哪把武器', () => {
    saveLoadout('WeaponA');
    assert.equal(lastWeaponId(), 'WeaponA');
    saveLoadout('WeaponB');
    assert.equal(lastWeaponId(), 'WeaponB');
  });

  it('每把武器各带一份界面状态（模式 / 勾选 / 配置区）', () => {
    const ui = { modeIndex: 2, selectedVariants: [1, 2], faction: 'grineer', coStacks: 5 };
    const a = makeLoadoutEntry([], null, null);
    a.ui = ui;
    saveLoadout('WeaponA', a, ui);
    const backA = must(getSavedLoadout('WeaponA'));
    assert.ok(backA.ui);
    assert.equal(backA.ui.modeIndex, 2);
    assert.deepEqual(backA.ui.selectedVariants, [1, 2]);
    assert.equal(backA.ui.faction, 'grineer');
    // 另一把没有 ui 时是 null
    saveLoadout('WeaponB', makeLoadoutEntry([], null, null));
    assert.equal(must(getSavedLoadout('WeaponB')).ui, null);
    // 顶层 ui 记录最后一次
    const lastUi = lastUiState();
    assert.ok(lastUi);
    assert.equal(lastUi.faction, 'grineer');
  });
});

describe('配卡存档：坏数据不影响页面', () => {
  beforeEach(() => { installStorage(); });

  it('存档是坏 JSON → 当作没有存档', () => {
    storageSet(LOADOUT_STORE_KEY, '{这不是 JSON');
    assert.equal(getSavedLoadout('Any'), null);
    assert.equal(lastWeaponId(), null);
    assert.equal(lastUiState(), null);
  });

  it('形状不对的槽位落成 null，不让坏值流进界面', () => {
    storageSet(LOADOUT_STORE_KEY, JSON.stringify({
      version: 1,
      current: 'W',
      order: ['W'],
      loadouts: { W: { slots: [123, '', null, 'ok_mod'], exilus: 42, arcane: {} } },
    }));
    const back = must(getSavedLoadout('W'));
    assert.deepEqual(back.slots, [null, null, null, 'ok_mod', null, null, null, null]);
    assert.equal(back.exilus, null);
    assert.equal(back.arcane, null);
  });

  it('访问 localStorage 就抛错（隐私模式）→ 读返回 null、写不报错', () => {
    withBrokenStorage(() => {
      assert.equal(getSavedLoadout('Any'), null);
      assert.equal(saveLoadout('Any', makeLoadoutEntry([], null, null)), false);
      clearLoadoutStore(); // 不应抛错
    });
  });

  it('clearLoadoutStore 之后读不到东西', () => {
    saveLoadout('WeaponA', makeLoadoutEntry(slots('m1'), null, null));
    assert.ok(getSavedLoadout('WeaponA'));
    clearLoadoutStore();
    assert.equal(getSavedLoadout('WeaponA'), null);
    assert.equal(lastWeaponId(), null);
  });
});

describe('配卡存档：条数上限', () => {
  beforeEach(() => { installStorage(); });

  it('超过上限时淘汰最久没用的，当前那把一定在', () => {
    for (let i = 0; i < LOADOUT_MAX_WEAPONS + 5; i++) {
      saveLoadout('W' + i, makeLoadoutEntry(slots('m' + i), null, null));
    }
    const newest = 'W' + (LOADOUT_MAX_WEAPONS + 4);
    assert.ok(getSavedLoadout(newest));
    assert.equal(getSavedLoadout('W0'), null, '最早的被淘汰');
    const raw = storageGet(LOADOUT_STORE_KEY);
    assert.ok(raw);
    const st = JSON.parse(raw);
    assert.equal(st.order.length, LOADOUT_MAX_WEAPONS);
    assert.equal(Object.keys(st.loadouts).length, LOADOUT_MAX_WEAPONS);
  });

  it('再存一次老武器会把它提到最前，不被淘汰', () => {
    for (let i = 0; i < LOADOUT_MAX_WEAPONS; i++) {
      saveLoadout('W' + i, makeLoadoutEntry(slots('m' + i), null, null));
    }
    saveLoadout('W0', makeLoadoutEntry(slots('m0-again'), null, null));
    saveLoadout('W-new', makeLoadoutEntry(slots('mnew'), null, null));
    assert.equal(must(getSavedLoadout('W0')).slots[0], 'm0-again');
    assert.equal(getSavedLoadout('W1'), null, 'W1 变成最久没用的，被淘汰');
  });
});
