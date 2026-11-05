/**
 * 镀层类数据层规则测试（A-03 / D-024）：
 *   · 镀层类 = 「击杀后获得 buff，最多叠加 y 次」→ 用 conditions[].maxStacks 当 y；
 *   · 异况超量 = **常驻生效、恒 1 层**（2026-11-05 需求方确认）→ y 恒为 1。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { conditionOverloadMaxStacks, isAlwaysOnConditionOverload, isConditionOverloadMod } from '../src/adapter.ts';

const ROOT = normalize(join(fileURLToPath(new URL('.', import.meta.url)), '../../..'));

const mods = JSON.parse(await readFile(join(ROOT, 'packages/data/src/generated/mods/mods.json'), 'utf8')).mods;
const byId = new Map(mods.map((m) => [m.id, m]));

describe('镀层类的叠层上限（D-024）', () => {
  it('异况超量：常驻生效，y 恒为 1', () => {
    const mod = byId.get('condition_overload');
    assert.ok(isConditionOverloadMod(mod));
    assert.equal(isAlwaysOnConditionOverload(mod), true);
    assert.equal(conditionOverloadMaxStacks(mod), 1);
  });

  it('镀层 步枪才能：y = 2（来自 conditions[].maxStacks）', () => {
    const mod = byId.get('galvanized_aptitude');
    assert.equal(isAlwaysOnConditionOverload(mod), false);
    assert.equal(conditionOverloadMaxStacks(mod), 2);
  });

  it('镀层 准确射手：y = 3', () => {
    assert.equal(conditionOverloadMaxStacks(byId.get('galvanized_shot')), 3);
  });

  it('镀层 通晓霰弹枪：y = 2', () => {
    assert.equal(conditionOverloadMaxStacks(byId.get('galvanized_savvy')), 2);
  });

  it('普通 Mod（无 co 键）返回 null', () => {
    const mod = byId.get('serration');
    assert.equal(isConditionOverloadMod(mod), false);
    assert.equal(conditionOverloadMaxStacks(mod), null);
  });
});
