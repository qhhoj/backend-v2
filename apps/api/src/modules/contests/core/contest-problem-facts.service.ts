import { Injectable } from '@nestjs/common';
import type { Principal } from '@libs/auth';
import { isFrozenFor, LIVE, standingOf } from '@libs/contests';
import { uuidStr } from '@libs/database';
import { ProblemsRepository } from '../../problems/core/problems.repository';
import { ContestAccess } from './contest-access';
import type { ContestViewer } from './contest-viewer.service';
import type { ContestDocument } from './contests.repository';
import type { ContestProblemFacts } from './dto/contest-detail.response';
import { ParticipationsRepository } from './participations.repository';
import type { ParticipationDocument } from './participations.repository';
import { SolverCountsService } from './solver-counts.service';
import { viewerProblemResults } from './viewer-problem-results';

const isScoring = (participation: ParticipationDocument) =>
  participation.virtual >= LIVE;

/** The participation whose results the detail shows: the current one when it scores (live or virtual), else the live one. */
const scoringParticipationOf = (
  viewer: ContestViewer,
): ParticipationDocument | null =>
  viewer.current && isScoring(viewer.current) ? viewer.current : viewer.live;

/** Non-editors see the frozen cells and counts during a freeze; editors always see the live ones. */
const isFrozenViewOf = (
  principal: Principal | null,
  contest: ContestDocument,
  now: Date,
): boolean =>
  isFrozenFor(
    contest,
    now,
    ContestAccess.canEdit(principal, ContestAccess.accessView(contest)),
  );

/** The detail's problem rows and what the viewer may see of them. */
@Injectable()
export class ContestProblemFactsService {
  constructor(
    private readonly problems: ProblemsRepository,
    private readonly participations: ParticipationsRepository,
    private readonly solvers: SolverCountsService,
  ) {}

  /** Cells follow the ranking, frozen for non-editors during a freeze; solver counts follow `canSeeFullScoreboard`. */
  async factsFor(
    principal: Principal | null,
    contest: ContestDocument,
    viewer: ContestViewer,
    now: Date,
  ): Promise<ContestProblemFacts> {
    const isFrozenView = isFrozenViewOf(principal, contest, now);
    const canSeeBoard = ContestAccess.canSeeFullScoreboard(
      principal,
      ContestAccess.accessView(contest),
      now,
      viewer,
    );
    const [summaries, viewerResults, solverCounts] = await Promise.all([
      this.problems.findSummaries(
        contest.problems.map((entry) => uuidStr(entry.problem)),
      ),
      this.viewerResultsOf(principal, contest, viewer, now),
      canSeeBoard ? this.solvers.countsOf(contest, isFrozenView) : null,
    ]);
    return {
      summaries: summaries.map(({ _id, code, name }) => ({ _id, code, name })),
      viewerResults,
      solverCounts,
    };
  }

  /** Only a viewer who may see their own row gets their cells. */
  private async viewerResultsOf(
    principal: Principal | null,
    contest: ContestDocument,
    viewer: ContestViewer,
    now: Date,
  ): Promise<ContestProblemFacts['viewerResults']> {
    const view = ContestAccess.accessView(contest);
    const participation = scoringParticipationOf(viewer);
    if (
      !participation ||
      !ContestAccess.canSeeOwnScoreboard(principal, view, now, viewer)
    )
      return null;
    const isFrozenView = isFrozenViewOf(principal, contest, now);
    return viewerProblemResults({
      problems: contest.problems.map((entry) => ({
        problemId: uuidStr(entry.problem),
        points: entry.points,
      })),
      cells: standingOf(participation.toObject(), isFrozenView).cells,
      submissions: await this.participations.submissionStatusesOf(
        uuidStr(participation._id),
      ),
    });
  }
}
