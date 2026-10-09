import { tagSlug } from './contest-tags';

describe('tagSlug', () => {
  it.each([
    ['Vòng 1', 'vong-1'],
    ['ICPC', 'icpc'],
    ['Đề thi HSG', 'de-thi-hsg'],
    ['  --  ', null],
    ['a'.repeat(30), 'a'.repeat(20)],
  ])('%s → %s', (name, slug) => expect(tagSlug(name)).toBe(slug));
});
