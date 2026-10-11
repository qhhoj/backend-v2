import type { Problem } from '@libs/database';
import { isEditorialPublished, searchFilter } from './problem-search';

describe('searchFilter', () => {
  const clauses = (search: string) =>
    (searchFilter(search) as { $and: Array<{ $or: unknown[] }> }).$and;
  it('requires every word to match the code or a title', () => {
    const words = clauses('luc  giac');
    expect(words).toHaveLength(2);
    expect(words[0].$or).toHaveLength(3);
    const [code, name, translation] = words[0].$or as Array<
      Record<string, RegExp>
    >;
    expect(Object.keys(code)).toEqual(['code']);
    expect(Object.keys(name)).toEqual(['name']);
    expect(Object.keys(translation)).toEqual(['translations.name']);
    expect(code.code.test('Lục')).toBe(true);
    expect(code.code.test('lxc')).toBe(false);
  });
  it('caps the number of words', () => {
    expect(clauses('a b c d e f g h i j')).toHaveLength(8);
  });
});

describe('isEditorialPublished', () => {
  const solution = (isPublic: boolean, publishOn: Date) =>
    ({ isPublic, publishOn }) as Problem['solution'];
  it('needs a public editorial whose publish time has passed', () => {
    expect(isEditorialPublished(null)).toBe(false);
    expect(isEditorialPublished(solution(false, new Date(0)))).toBe(false);
    expect(
      isEditorialPublished(solution(true, new Date(Date.now() + 1e6))),
    ).toBe(false);
    expect(isEditorialPublished(solution(true, new Date(0)))).toBe(true);
  });
});
