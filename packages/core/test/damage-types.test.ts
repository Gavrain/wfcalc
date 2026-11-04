import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DT_KEY_MAP, DAMAGE_TYPES, spreadTotal, scaleSpread, isCompound } from '../src/index.ts';

describe('damage types', () => {
  it('maps every DT_* export key to a known damage type', () => {
    for (const key of Object.keys(DT_KEY_MAP)) {
      assert.ok(DAMAGE_TYPES.includes(DT_KEY_MAP[key]!), `${key} maps to unknown type`);
    }
  });

  it('sums a spread', () => {
    assert.equal(spreadTotal({ impact: 1.5, slash: 2 }), 3.5);
    assert.equal(spreadTotal({}), 0);
  });

  it('scales a spread proportionally', () => {
    const out = scaleSpread({ impact: 10, slash: 30 }, 2);
    assert.equal(out.impact, 20);
    assert.equal(out.slash, 60);
  });

  it('returns the spread unchanged when the total is zero', () => {
    assert.deepEqual(scaleSpread({ impact: 0 }, 5), { impact: 0 });
  });

  it('classifies compound elements', () => {
    assert.equal(isCompound('viral'), true);
    assert.equal(isCompound('impact'), false);
    assert.equal(isCompound('heat'), false);
  });
});
