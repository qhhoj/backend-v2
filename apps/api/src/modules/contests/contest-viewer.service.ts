import { Injectable } from '@nestjs/common';
import type { Principal } from '@libs/auth';
import {
  contestPhase,
  hasParticipationEnded,
  LIVE,
  SPECTATE,
} from '@libs/contests';
import { uuidStr } from '@libs/database';
import { NO_FACTS } from './contest-access';
import type { ViewerFacts } from './contest-access';
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
  constructor(private readonly participations: ParticipationsRepository) {}

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
