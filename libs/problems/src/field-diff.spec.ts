import { fieldDiff } from './field-diff';

describe('fieldDiff', () => {
  it('lists changed fields with before/after and ignores derived ones', () => {
    const before = {
      id: '1',
      code: 'a',
      points: 1000,
      authors: ['x'],
      descriptionHtml: '<p>',
      updatedAt: new Date(1),
    };
    const after = {
      id: '1',
      code: 'b',
      points: 1000,
      authors: ['x', 'y'],
      descriptionHtml: '<p>b',
      updatedAt: new Date(2),
      date: new Date(0),
    };
    expect(fieldDiff(before, after)).toEqual({
      code: { before: 'a', after: 'b' },
      authors: { before: ['x'], after: ['x', 'y'] },
      date: { before: null, after: new Date(0) },
    });
  });
});
