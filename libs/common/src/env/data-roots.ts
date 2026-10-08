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

/** Unset roots (null) are never inside anything. */
function isSetAndInside(child: string | null, parent: string | null): boolean {
  return !!child && !!parent && isInside(child, parent);
}

/** MEDIA_ROOT is served publicly: the contest and user data zips must live outside it and apart from each other. */
export function checkDataRoots({
  mediaRoot,
  contestDataRoot,
  userDataRoot,
}: Pick<Env, 'mediaRoot' | 'contestDataRoot' | 'userDataRoot'>): string[] {
  const rules: [violated: boolean, problem: string][] = [
    [
      isSetAndInside(contestDataRoot, mediaRoot),
      'CONTEST_DATA_ROOT must not be inside MEDIA_ROOT',
    ],
    [
      isSetAndInside(userDataRoot, mediaRoot),
      'USER_DATA_ROOT must not be inside MEDIA_ROOT',
    ],
    [
      isSetAndInside(userDataRoot, contestDataRoot) ||
        isSetAndInside(contestDataRoot, userDataRoot),
      'USER_DATA_ROOT and CONTEST_DATA_ROOT must be separate directories',
    ],
  ];
  return rules.filter(([violated]) => violated).map(([, problem]) => problem);
}
