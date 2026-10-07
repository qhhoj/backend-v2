import { canWritePersonalPost, postSlug } from './blog-posts';

describe('blog post rules', () => {
  const writer = (problemCount: number, extra = {}) => ({
    isSuperuser: false,
    problemCount,
    mute: false,
    ...extra,
  });

  it('needs 10 solved problems, superusers aside, and never a muted writer', () => {
    expect(canWritePersonalPost(writer(9))).toBe(false);
    expect(canWritePersonalPost(writer(10))).toBe(true);
    expect(canWritePersonalPost(writer(0, { isSuperuser: true }))).toBe(true);
    expect(canWritePersonalPost(writer(50, { mute: true }))).toBe(false);
    expect(
      canWritePersonalPost(writer(0, { isSuperuser: true, mute: true })),
    ).toBe(false);
  });

  it('slugs like legacy remove_accents(username.lower())', () => {
    // `Đ` has no combining decomposition: NFKD keeps it, lowercasing gives `đ`.
    expect(postSlug('Nguyễn_Văn_Đạt')).toBe('nguyen_van_đat');
    expect(postSlug('Alice')).toBe('alice');
    expect(postSlug('a b/c')).toBe('a-b-c');
    expect(postSlug('!!!')).toBe('post');
  });
});
