import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveName, nameCoverage } from '../src/localize.ts';

const zh = {
  '/Lotus/Language/Items/RifleName': '布莱顿',
  '/Lotus/Language/ClanTech/RocketLauncher': '食人女魔',
};
const en = {
  '/Lotus/Language/Items/RifleName': 'Braton',
  '/Lotus/Language/ClanTech/RocketLauncher': 'Ogris',
};

describe('语言包名称解析', () => {
  it('中英文都命中', () => {
    assert.deepEqual(resolveName('/Lotus/Language/Items/RifleName', zh, en), {
      en: 'Braton',
      zh: '布莱顿',
    });
  });

  it('只有中文命中时中文照常返回', () => {
    const r = resolveName('/Lotus/Language/Items/RifleName', zh);
    assert.equal(r.zh, '布莱顿');
    assert.equal(r.en, 'RifleName');
  });

  it('语言键缺失时返回占位', () => {
    assert.deepEqual(resolveName(undefined, zh, en), { en: '(未知)' });
  });

  it('两包都未命中时回退到键的末段', () => {
    const r = resolveName('/Lotus/Language/Items/UnknownName', {}, {});
    assert.equal(r.en, 'UnknownName');
    assert.equal(r.zh, undefined);
  });
});

describe('名称覆盖率统计', () => {
  it('统计命中与缺失样例', () => {
    const cov = nameCoverage(['/Lotus/Language/Items/RifleName', '/missing'], zh);
    assert.equal(cov.total, 2);
    assert.equal(cov.hit, 1);
    assert.equal(cov.ratio, 0.5);
    assert.deepEqual(cov.missingSamples, ['/missing']);
  });

  it('空输入不除零', () => {
    assert.equal(nameCoverage([], zh).ratio, 0);
  });
});
