import { Injectable } from '@nestjs/common';
import type { Principal } from '@libs/auth';
import { hasParticipationEnded, LIVE, SPECTATE } from '@libs/contests';
import { uuidStr } from '@libs/database';
import type { ContestScope } from '../../problems/core/problem-access';
import { ContestAccess } from './contest-access';
import { contestScopeOf } from './contest-scope';
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

  /** The participation the user is in; an ended or vanished one, one whose contest the user can no longer see, or a spectator row they may no longer hold (`ContestAccess.keepsSpectating`), is cleared (compare-and-set) and reads as none. */
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
      !(await this.stillCounts(principal, { participation, contest }, now))
    ) {
      await this.participations.clearCurrent(principal.userId, pointer);
      return null;
    }
    return { participation, contest };
  }

  private async stillCounts(
    principal: Principal,
    { participation, contest }: CurrentParticipation,
    now: Date,
  ): Promise<boolean> {
    const view = ContestAccess.accessView(contest);
    if (
      hasParticipationEnded(contest, participation, now) ||
      !ContestAccess.canSee(principal, view)
    )
      return false;
    if (
      participation.virtual !== SPECTATE ||
      ContestAccess.keepsSpectating(principal, view, false)
    )
      return true;
    const live = await this.participations.findOne(
      contest._id,
      principal.userId,
      LIVE,
    );
    return ContestAccess.keepsSpectating(principal, view, live !== null);
  }

  /** What the user's current contest does to problem access (`ProblemAccess`); null outside a contest. */
  scopeFrom(
    current: CurrentParticipation | null,
    now = new Date(),
  ): ContestScope | null {
    return current && contestScopeOf(current.contest, now);
  }

  async scopeOf(
    principal: Principal | null,
    now = new Date(),
  ): Promise<ContestScope | null> {
    return this.scopeFrom(await this.current(principal, now), now);
  }
}
