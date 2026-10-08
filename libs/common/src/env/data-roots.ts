import { realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { Env } from './env';

/** Symlinks followed, as nginx does; a root not created yet resolves through its nearest existing ancestor. A bind mount overlapping at the host level is not detected. */
function realPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    const parent = dirname(resolve(path));
    return parent === resolve(path)
      ? parent
      : join(realPath(parent), resolve(path).slice(parent.length + 1));
  }
}

export function isInside(child: string, parent: string): boolean {
  const relation = relative(realPath(parent), realPath(child));
  // `..cache` is a child; only a leading `..` segment leaves the parent.
  return relation.split(sep)[0] !== '..' && !isAbsolute(relation);
}

/** MEDIA_ROOT is served publicly: the contest and user data zips must live outside it and apart from each other. */
export function checkDataRoots({
  mediaRoot,
  contestDataRoot,
  userDataRoot,
}: Pick<Env, 'mediaRoot' | 'contestDataRoot' | 'userDataRoot'>): string[] {
  const problems: string[] = [];
  if (contestDataRoot && mediaRoot && isInside(contestDataRoot, mediaRoot))
    problems.push('CONTEST_DATA_ROOT must not be inside MEDIA_ROOT');
  if (userDataRoot && mediaRoot && isInside(userDataRoot, mediaRoot))
    problems.push('USER_DATA_ROOT must not be inside MEDIA_ROOT');
  if (
    userDataRoot &&
    contestDataRoot &&
    (isInside(userDataRoot, contestDataRoot) ||
      isInside(contestDataRoot, userDataRoot))
  )
    problems.push(
      'USER_DATA_ROOT and CONTEST_DATA_ROOT must be separate directories',
    );
  return problems;
}
