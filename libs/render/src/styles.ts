export const RENDER_STYLES = ['problem', 'problem-full', 'solution'] as const;
export type RenderStyle = (typeof RENDER_STYLES)[number];
/** `problem-full` (permission `judge.problem_full_markup`) is the only style whose HTML is not sanitized. */
export const isSanitizedStyle = (style: RenderStyle): boolean =>
  style !== 'problem-full';
