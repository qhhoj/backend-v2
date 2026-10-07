import { AppError } from '@libs/common';
import type { Problem } from '@libs/database';
import { renderMarkdown, RenderLimitError } from '@libs/render';
import type { RenderStyle } from '@libs/render';

/** `renderMarkdown` with a render limit reported as `validation_failed` on the rendered `field`. */
export function renderField(
  text: string,
  style: RenderStyle,
  field: string,
): string {
  try {
    return renderMarkdown(text, style);
  } catch (error) {
    if (!(error instanceof RenderLimitError)) throw error;
    throw new AppError('validation_failed', 400, error.message, {
      [field]: [error.message],
    });
  }
}

/** The one place that maps a problem to its statement render style. */
export function styleOf(problem: Pick<Problem, 'isFullMarkup'>): RenderStyle {
  return problem.isFullMarkup ? 'problem-full' : 'problem';
}
