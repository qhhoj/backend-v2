import { isInsideReal } from '../storage/paths';
import type { DataRootsConfig } from './config-parts';

/** Unset roots (null) are never inside anything. */
function isSetAndInside(child: string | null, parent: string | null): boolean {
  return !!child && !!parent && isInsideReal(parent, child);
}

/** MEDIA_ROOT is served publicly: the contest and user data zips must live outside it and apart from each other. */
export function checkDataRoots({
  mediaRoot,
  contestDataRoot,
  userDataRoot,
}: Pick<
  DataRootsConfig,
  'mediaRoot' | 'contestDataRoot' | 'userDataRoot'
>): string[] {
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
