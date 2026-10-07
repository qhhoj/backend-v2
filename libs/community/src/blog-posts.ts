/** Legacy `VNOJ_BLOG_MIN_PROBLEM_COUNT`. */
export const BLOG_MIN_PROBLEM_COUNT = 10;
/** Legacy `PostListBase.paginate_by`. */
export const BLOG_PAGE_SIZE = 10;
export const BLOG_TITLE_MAX_LENGTH = 100;

export interface PostWriter {
  isSuperuser: boolean;
  problemCount: number;
  mute: boolean;
}

/** Legacy `BlogPostCreate.dispatch` (superusers bypass the count, staff do not); muted writers are refused (new: muting silences public text). Organization posts use the admin rule instead. */
export const canWritePersonalPost = (writer: PostWriter): boolean =>
  !writer.mute &&
  (writer.isSuperuser || writer.problemCount >= BLOG_MIN_PROBLEM_COUNT);

/** Legacy `remove_accents(username.lower())`, made URL-safe. */
export const postSlug = (source: string): string =>
  source
    .normalize('NFKD')
    .replace(/\p{Mn}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 128) || 'post';
