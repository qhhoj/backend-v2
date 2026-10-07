export const RENDER_STYLES = [
  'problem',
  'problem-full',
  'solution',
  'user',
] as const;
export type RenderStyle = (typeof RENDER_STYLES)[number];
/** `problem-full` (permission `judge.problem_full_markup`) is the only style whose HTML is not sanitized. */
export const isSanitizedStyle = (style: RenderStyle): boolean =>
  style !== 'problem-full';
/** Legacy `safe_mode: 'escape'` (`self-description`, `organization-about`, later comments): raw HTML is shown as text. */
export const allowsRawHtml = (style: RenderStyle): boolean => style !== 'user';
