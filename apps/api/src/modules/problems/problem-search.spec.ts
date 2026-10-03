import { listSort, searchFilter } from './problem-search';

describe('searchFilter', () => {
  it('uses the text index for queries of three or more characters', () =>
    expect(searchFilter('C++')).toEqual({ $text: { $search: 'C++' } }));
  it('escapes short queries into anchored prefix regexes', () => {
    const filter = searchFilter('c+') as {
      $or: Array<Record<string, RegExp>>;
    };
    expect(filter.$or.map((clause) => Object.keys(clause)[0])).toEqual([
      'code',
      'name',
      'translations.name',
    ]);
    expect(filter.$or[0].code.source).toBe('^c\\+');
    expect(filter.$or[0].code.flags).toBe('i');
    expect(
      searchFilter('a(') as { $or: Array<Record<string, RegExp>> },
    ).toMatchObject({
      $or: [
        { code: /^a\(/i },
        { name: /^a\(/i },
        { 'translations.name': /^a\(/i },
      ],
    });
  });
});

describe('listSort', () => {
  it('maps the sort key and keeps _id as tie-break', () => {
    expect(listSort('-date')).toEqual({ date: -1, _id: 1 });
    expect(listSort('name')).toEqual({ name: 1, _id: 1 });
  });
});
