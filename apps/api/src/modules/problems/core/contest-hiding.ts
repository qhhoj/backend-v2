import type { Principal } from '@libs/auth';
import { uuidStr } from '@libs/database';
import { ContestAccess } from '../../contests/core/contest-access';
import type { CurrentParticipation } from '../../contests/core/current-contest.service';

/** The problem facts the viewer's current contest withholds (`hideProblemTags`, `hideProblemAuthors`). */
export interface ContestHiding {
  tags: boolean;
  authors: boolean;
  /** Only the contest's own problems are withheld. */
  problemIds: ReadonlySet<string>;
}

const NOTHING: ContestHiding = {
  tags: false,
  authors: false,
  problemIds: new Set(),
};

/** Contest editors (staff with `edit_all_contest`, authors and curators with `edit_own_contest`) keep seeing everything. */
export function contestHiding(
  principal: Principal | null,
  current: CurrentParticipation | null,
): ContestHiding {
  if (!current) return NOTHING;
  const { contest } = current;
  const view = ContestAccess.accessView(contest);
  if (ContestAccess.canEdit(principal, view)) return NOTHING;
  return {
    tags: contest.hideProblemTags,
    authors: contest.hideProblemAuthors,
    problemIds: new Set(
      contest.problems.map((entry) => uuidStr(entry.problem)),
    ),
  };
}

/** Blank the withheld fields of one problem's response. */
export function withheld<Row extends { types: unknown[]; authors: unknown[] }>(
  hiding: ContestHiding,
  problemId: string,
  row: Row,
): Row {
  if (!hiding.problemIds.has(problemId)) return row;
  return {
    ...row,
    types: hiding.tags ? [] : row.types,
    authors: hiding.authors ? [] : row.authors,
  };
}
