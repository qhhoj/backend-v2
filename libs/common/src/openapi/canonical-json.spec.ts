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

  it('sorts enum lists (numbers numerically, strings by code point) but no other array', () => {
    const text = canonicalJson({
      properties: { enum: { type: 'string' } },
      a: { enum: ['edit', 'delete', 'create'] },
      b: { enum: [1, -1, 0, 10, 2] },
      c: { list: ['b', 'a'] },
    });
    const parsed = JSON.parse(text) as {
      a: { enum: string[] };
      b: { enum: number[] };
      c: { list: string[] };
      properties: { enum: object };
    };
    expect(parsed.a.enum).toEqual(['create', 'delete', 'edit']);
    expect(parsed.b.enum).toEqual([-1, 0, 1, 2, 10]);
    expect(parsed.c.list).toEqual(['b', 'a']);
    expect(parsed.properties.enum).toEqual({ type: 'string' });
  });
});
