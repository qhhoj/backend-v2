export const RENDER_STYLES = [
  'problem',
  'problem-full',
  'solution',
  'blog',
  'user',
] as const;
export type RenderStyle = (typeof RENDER_STYLES)[number];
/** `blog` is `solution` confined to the post's own box (user-authored, unlike staff editorials). `problem-full` (permission `judge.problem_full_markup`) is the only style whose HTML is not sanitized. */
export const isSanitizedStyle = (style: RenderStyle): boolean =>
  style !== 'problem-full';
/** Legacy `safe_mode: 'escape'` (`self-description`, `organization-about`, later comments): raw HTML is shown as text. */
export const allowsRawHtml = (style: RenderStyle): boolean => style !== 'user';
/** Text written by users (not staff): KaTeX is cut down to what a stranger's formula may cost. */
export const isUserAuthored = (style: RenderStyle): boolean =>
  style === 'user' || style === 'blog';
