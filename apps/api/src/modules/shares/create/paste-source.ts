import { invalidField } from '@libs/common';
import type { ValidationFailedError } from '@libs/common';

/** A paste's size cap, in UTF-8 bytes (also under `MAX_SOURCE_LENGTH` code points, which is never the tighter one). */
export const PASTE_MAX_BYTES = 64 * 1024;
/** The route's body cap: the source escaped as JSON plus the other fields. */
export const PASTE_BODY_LIMIT_BYTES = 300 * 1024;

/** Null when the text may be stored: not empty, at most `PASTE_MAX_BYTES`, no NUL. */
export function pasteSourceError(source: string): ValidationFailedError | null {
  if (source.trim() === '')
    return invalidField('source', 'Paste some code first.', 'source_empty');
  if (Buffer.byteLength(source) > PASTE_MAX_BYTES)
    return invalidField(
      'source',
      `At most ${PASTE_MAX_BYTES} bytes.`,
      'source_too_large',
    );
  return source.includes('\0')
    ? invalidField('source', 'Text only: no NUL characters.', 'source_invalid')
    : null;
}
