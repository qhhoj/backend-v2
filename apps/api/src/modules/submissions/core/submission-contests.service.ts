import { Injectable } from '@nestjs/common';
import type { Principal } from '@libs/auth';
import { unique } from '@libs/common';
import { uuidStr } from '@libs/database';
import type { Contest, Problem, Submission } from '@libs/database';
import { ContestAccess } from '../../contests/core/contest-access';
import { ContestsRepository } from '../../contests/core/contests.repository';
import { ParticipationsRepository } from '../../contests/core/participations.repository';
import type { SubmissionContestResponse } from './dto/submission-list.response';
import { contestBlock } from './submission-contest-block';
import { SubmissionsRepository } from './submissions.repository';
import type { ContestRowFields } from './submissions.repository';

/** A contest submission with the contest the viewer may see it in. */
interface InVisibleContest {
  submission: Submission;
  contest: Contest;
}

/** The contest block of submissions, loaded for a whole page at once: three `_id` lookups (contests, contest rows, runs) however many rows there are. */
@Injectable()
export class SubmissionContestsService {
  constructor(
    private readonly contests: ContestsRepository,
    private readonly submissions: SubmissionsRepository,
    private readonly participations: ParticipationsRepository,
  ) {}

  /** The result page's contest block: `blocksOf` for one submission, null when it has none. */
  async blockOf(
    principal: Principal | null,
    submission: Submission,
    problem: Pick<Problem, '_id' | 'partial'>,
  ): Promise<SubmissionContestResponse | null> {
    const blocks = await this.blocksOf(
      principal,
      [submission],
      new Map([[problem._id, problem]]),
    );
    return blocks.get(uuidStr(submission._id)) ?? null;
  }

  /** The block of each submission that is in a contest the viewer may see (`ContestAccess.canSee`, whatever the submission list or page already decided about the row), keyed by submission id; the others have no entry. A deleted problem keeps its contest. The run minute is the submitter's own only. */
  async blocksOf(
    principal: Principal | null,
    submissions: readonly Submission[],
    problemOf: ReadonlyMap<string, Pick<Problem, 'partial'>>,
  ): Promise<Map<string, SubmissionContestResponse>> {
    const shown = await this.inVisibleContests(principal, submissions);
    const rows = await this.submissions.contestRows(
      shown.map(({ submission }) => uuidStr(submission._id)),
    );
    const runs = await this.participations.runsByIds(
      ownRunIds(principal, shown, rows),
    );
    return new Map(
      shown.map(({ submission, contest }) => {
        const id = uuidStr(submission._id);
        const row = rows.get(id);
        const run =
          row && isOwn(principal, submission)
            ? runs.get(uuidStr(row.participation))
            : undefined;
        const problemPartial =
          problemOf.get(uuidStr(submission.problem))?.partial ?? false;
        return [
          id,
          contestBlock(submission, { contest, problemPartial, row, run }),
        ];
      }),
    );
  }

  private async inVisibleContests(
    principal: Principal | null,
    submissions: readonly Submission[],
  ): Promise<InVisibleContest[]> {
    const inContest = submissions.filter((submission) => submission.contest);
    const found = await this.contests.findByIds(
      unique(inContest.map((submission) => uuidStr(submission.contest))),
    );
    const visible = new Map(
      found
        .filter((contest) =>
          ContestAccess.canSee(principal, ContestAccess.accessView(contest)),
        )
        .map((contest) => [uuidStr(contest._id), contest]),
    );
    return inContest.flatMap((submission) => {
      const contest = visible.get(uuidStr(submission.contest));
      return contest ? [{ submission, contest }] : [];
    });
  }
}

const isOwn = (principal: Principal | null, submission: Submission): boolean =>
  principal?.userId === uuidStr(submission.user);

/** The runs of the viewer's own submissions: only those show a minute. */
const ownRunIds = (
  principal: Principal | null,
  shown: readonly InVisibleContest[],
  rows: ReadonlyMap<string, ContestRowFields>,
): string[] =>
  unique(
    shown.flatMap(({ submission }) => {
      const row = rows.get(uuidStr(submission._id));
      return row && isOwn(principal, submission)
        ? [uuidStr(row.participation)]
        : [];
    }),
  );
