import { Injectable } from '@nestjs/common';
import { hasPermission } from '@libs/auth';
import { AppError } from '@libs/common';
import type { Principal } from '@libs/auth';
import {
  contestPhase,
  hasParticipationEnded,
  LIVE,
  SPECTATE,
} from '@libs/contests';
import { CONTEST_KEY_PATTERN, uuidStr } from '@libs/database';
import { ContestAccess, NO_FACTS } from './contest-access';
import type { ViewerFacts } from './contest-access';
import { ContestsRepository } from './contests.repository';
import type { ContestDocument } from './contests.repository';
import { ParticipationsRepository } from './participations.repository';
import type { ParticipationDocument } from './participations.repository';

export interface ContestViewer extends ViewerFacts {
  live: ParticipationDocument | null;
  current: ParticipationDocument | null;
}

/** The viewer's participations in one contest, and the facts `ContestAccess` needs from them. */
@Injectable()
export class ContestViewerService {
  constructor(
    private readonly participations: ParticipationsRepository,
    private readonly contests: ContestsRepository,
  ) {}

  /** 404 for malformed, unknown and invisible keys alike, so existence never leaks. */
  async visibleContest(
    principal: Principal | null,
    key: string,
  ): Promise<ContestDocument> {
    const contest = CONTEST_KEY_PATTERN.test(key)
      ? await this.contests.findByKey(key)
      : null;
    if (
      !contest ||
      !ContestAccess.canSee(principal, ContestAccess.accessView(contest))
    )
      throw new AppError('not_found', 404, 'No such contest');
    return contest;
  }

  /** Contests whose full submission list the viewer may not see now; other users' submissions of these leave every submission list. */
  async hiddenSubmissionContests(
    principal: Principal | null,
    now: Date,
  ): Promise<string[]> {
    if (principal && hasPermission(principal, 'judge.view_all_submission'))
      return [];
    const candidates = await this.contests.candidatesHidingSubmissions(now);
    if (!candidates.length) return [];
    const live = principal
      ? await this.participations.liveOf(
          principal.userId,
          candidates.map((contest) => uuidStr(contest._id)),
        )
      : [];
    const liveOf = new Map(
      live.map((participation) => [
        uuidStr(participation.contest),
        participation,
      ]),
    );
    return candidates
      .filter((contest) => {
        const own = liveOf.get(uuidStr(contest._id));
        const facts = {
          inContest: false,
          completedLive:
            own !== undefined && hasParticipationEnded(contest, own, now),
        };
        return !ContestAccess.canSeeFullSubmissionList(
          principal,
          ContestAccess.accessView(contest),
          now,
          facts,
        );
      })
      .map((contest) => uuidStr(contest._id));
  }

  async viewerOf(
    principal: Principal | null,
    contest: ContestDocument,
    now: Date,
  ): Promise<ContestViewer> {
    if (!principal) return { ...NO_FACTS, live: null, current: null };
    const [current, live] = await Promise.all([
      this.participations.findCurrentOf(principal.userId),
      this.participations.findOne(contest._id, principal.userId, LIVE),
    ]);
    // An ended participation no longer counts, before any read clears the pointer (`CurrentContestService.current`).
    const currentHere =
      current !== null &&
      uuidStr(current.contest) === contest._id &&
      !hasParticipationEnded(contest, current, now)
        ? current
        : null;
    return {
      inContest:
        currentHere !== null &&
        (contestPhase(contest, now) !== 'upcoming' ||
          currentHere.virtual === SPECTATE),
      completedLive: live !== null && hasParticipationEnded(contest, live, now),
      live,
      current: currentHere,
    };
  }
}
