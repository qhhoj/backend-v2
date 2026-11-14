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

/** The one place that maps a statement text to its render style: unsanitized (`problem-full`) only on a full-markup problem and only for text a holder of `judge.problem_full_markup` trusted (`isMarkupTrusted`, see `markupTrustAfterSave`). */
export function styleOf(
  problem: Pick<Problem, 'isFullMarkup'>,
  isMarkupTrusted: boolean,
): RenderStyle {
  return problem.isFullMarkup && isMarkupTrusted ? 'problem-full' : 'problem';
}

/** A holder of `judge.problem_full_markup` may set a statement text's trust (see `markupTrustAfterSave`). */
export const isTrustedMarkupWriter = (principal: Principal): boolean =>
  hasPermission(principal, 'judge.problem_full_markup');

/**
 * Whether a statement text is trusted after a save. Trust changes only on request (`requested`), and only a holder of
 * `judge.problem_full_markup` may change it (anyone else gets 403); a save without a request never raises it: text changed
 * by a writer without the permission becomes untrusted, any other save keeps the stored trust.
 */
export function markupTrustAfterSave({
  isWriterTrusted,
  isTextChanged,
  wasTrusted,
  requested,
}: {
  isWriterTrusted: boolean;
  isTextChanged: boolean;
  wasTrusted: boolean;
  requested?: boolean;
}): boolean {
  if (requested !== undefined && requested !== wasTrusted && !isWriterTrusted)
    throw new AppError(
      'forbidden',
      403,
      'Trusting statement markup requires judge.problem_full_markup',
    );
  if (isWriterTrusted && requested !== undefined) return requested;
  return isTextChanged && !isWriterTrusted ? false : wasTrusted;
}
