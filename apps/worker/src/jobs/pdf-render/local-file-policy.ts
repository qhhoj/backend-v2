import { realpath } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const realpathOrNull = (path: string) => realpath(path).catch(() => null);

/** Only existing `file:` resources that really live in (symlinks resolved) or are one of `allowedPaths` may load: no network, no other local file. */
export async function isAllowedRequest(
  url: string,
  allowedPaths: string[],
): Promise<boolean> {
  let requested: string | null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'file:') return false;
    requested = await realpathOrNull(fileURLToPath(parsed));
  } catch {
    return false;
  }
  if (requested === null) return false;
  for (const allowedPath of allowedPaths) {
    const real = await realpathOrNull(allowedPath);
    if (
      real !== null &&
      (requested === real || requested.startsWith(real + sep))
    )
      return true;
  }
  return false;
}

/** The `MEDIA_ROOT` folders statements embed images from: site and Polygon uploads (`images`) and legacy uploads (`martor`). Never `submission_file` or the rest of the volume. */
const STATEMENT_MEDIA_DIRS = ['images', 'martor'];
export const statementMediaPaths = (mediaRoot: string): string[] =>
  STATEMENT_MEDIA_DIRS.map((folder) => join(mediaRoot, folder));
