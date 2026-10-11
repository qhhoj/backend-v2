import { join, resolve } from 'node:path';
import { SAFE_SEGMENT, SUBMISSION_FILE_DIR } from '@libs/common';
import type { Env } from '@libs/common';

/** The file under `MEDIA_ROOT/submission_file/` of a source stored as `${MEDIA_URL}/submission_file/<code>/<user>/<name>`; null for any other URL (legacy `/submission_file/...` rows the migrator has not rewritten) or an unsafe segment. */
export function submissionFilePath(
  { mediaRoot, mediaUrl }: Pick<Env, 'mediaRoot' | 'mediaUrl'>,
  url: string,
): string | null {
  const prefix = `${mediaUrl}/${SUBMISSION_FILE_DIR}/`;
  if (!url.startsWith(prefix)) return null;
  const segments = url.slice(prefix.length).split('/');
  const unsafe = segments.some(
    (segment) => !SAFE_SEGMENT.test(segment) || segment.includes('..'),
  );
  return unsafe
    ? null
    : join(resolve(mediaRoot), SUBMISSION_FILE_DIR, ...segments);
}
