import { hasPermission } from '@libs/auth';
import type { Principal } from '@libs/auth';
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

/** The one place that maps a statement text to its render style: unsanitized (`problem-full`) only on a full-markup problem and only for text whose writer held `judge.problem_full_markup` (`isMarkupTrusted`). */
export function styleOf(
  problem: Pick<Problem, 'isFullMarkup'>,
  isMarkupTrusted: boolean,
): RenderStyle {
  return problem.isFullMarkup && isMarkupTrusted ? 'problem-full' : 'problem';
}

/** Text written by a holder of `judge.problem_full_markup` is trusted: it may render unsanitized. */
export const isTrustedMarkupWriter = (principal: Principal): boolean =>
  hasPermission(principal, 'judge.problem_full_markup');

/** Whether a statement text is trusted after a save: changed text takes its writer's permission; unchanged text stays trusted, and a writer holding the permission who saves it vouches for it. */
export function markupTrustAfterSave({
  isWriterTrusted,
  isTextChanged,
  wasTrusted,
}: {
  isWriterTrusted: boolean;
  isTextChanged: boolean;
  wasTrusted: boolean;
}): boolean {
  return isTextChanged ? isWriterTrusted : wasTrusted || isWriterTrusted;
}
