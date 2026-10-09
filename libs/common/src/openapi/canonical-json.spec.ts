import { canonicalJson } from './canonical-json';

describe('canonicalJson', () => {
  it('gives the same text for the same data in any key order', () => {
    const left = {
      zeta: 1,
      alpha: { delta: [3, { yy: 1, xx: 2 }], charlie: null },
    };
    const right = {
      alpha: { charlie: null, delta: [3, { xx: 2, yy: 1 }] },
      zeta: 1,
    };
    expect(canonicalJson(left)).toBe(canonicalJson(right));
  });

  it('sorts object keys, keeps array order, indents by two and ends with one newline', () => {
    expect(canonicalJson({ list: ['b', 'a'], zeta: 1, alpha: 2 })).toBe(
      '{\n  "alpha": 2,\n  "list": [\n    "b",\n    "a"\n  ],\n  "zeta": 1\n}\n',
    );
  });
});
