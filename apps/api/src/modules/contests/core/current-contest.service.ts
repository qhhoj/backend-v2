import { Injectable } from '@nestjs/common';
import type { Principal } from '@libs/auth';
import { contestPhase, hasParticipationEnded } from '@libs/contests';
import { uuidStr } from '@libs/database';
import type { ContestScope } from '../../problems/core/problem-access';
import { ContestAccess } from './contest-access';
import { ContestsRepository } from './contests.repository';
import type { ContestDocument } from './contests.repository';
import { ParticipationsRepository } from './participations.repository';
import type { ParticipationDocument } from './participations.repository';

export interface CurrentParticipation {
  participation: ParticipationDocument;
  contest: ContestDocument;
}

/** Legacy `Profile.update_contest`, checked on read instead of by a middleware. */
@Injectable()
export class CurrentContestService {
  constructor(
    private readonly participations: ParticipationsRepository,
    private readonly contests: ContestsRepository,
  ) {}

  /** The participation the user is in; an ended or vanished one, or one whose contest the user can no longer see, is cleared (compare-and-set) and reads as none. */
  async current(
    principal: Principal | null,
    now = new Date(),
  ): Promise<CurrentParticipation | null> {
    if (!principal) return null;
    const pointer = await this.participations.currentIdOf(principal.userId);
    if (!pointer) return null;
    const participation = await this.participations.findById(pointer);
    const contest =
      participation &&
      (await this.contests.findById(uuidStr(participation.contest)));
    if (
      !participation ||
      !contest ||
      hasParticipationEnded(contest, participation, now) ||
      !ContestAccess.canSee(principal, ContestAccess.accessView(contest))
    ) {
      await this.participations.clearCurrent(principal.userId, pointer);
      return null;
    }
    return { participation, contest };
  }

  /** What the user's current contest does to problem access (`ProblemAccess`); null outside a contest. */
  async scopeOf(
    principal: Principal | null,
    now = new Date(),
  ): Promise<ContestScope | null> {
    const current = await this.current(principal, now);
    return (
      current && {
        started: contestPhase(current.contest, now) !== 'upcoming',
        problemIds: current.contest.problems.map((entry) =>
          uuidStr(entry.problem),
        ),
      }
    );
  }
}
