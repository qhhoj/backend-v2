import { Injectable } from '@nestjs/common';
import type { ServiceClientPrincipal } from '@libs/auth';
import { AppError } from '@libs/common';
import { uuidStr } from '@libs/database';
import { ContestsRepository } from '../../contests/core/contests.repository';
import type { ContestDocument } from '../../contests/core/contests.repository';

const isManagedBy = (
  contest: ContestDocument,
  client: ServiceClientPrincipal,
): boolean =>
  contest.managedBy !== null && uuidStr(contest.managedBy) === client.clientId;

/** The one rule that keeps clients off other people's contests: ownership (`managedBy`), never a key prefix. */
@Injectable()
export class SyncContestOwnership {
  constructor(private readonly contests: ContestsRepository) {}

  /** For `PUT`, which may create: the contest at `key` when this client created it, null when the key is free, and one 403 for any other existing contest, a person's or another client's alike. The client chose the key, so learning that it is taken tells it nothing new. */
  async find(
    client: ServiceClientPrincipal,
    key: string,
  ): Promise<ContestDocument | null> {
    const contest = await this.contests.findByKey(key);
    if (contest && !isManagedBy(contest, client))
      throw new AppError(
        'forbidden',
        403,
        'This contest is not managed by this client',
      );
    return contest;
  }

  /** For `GET`, `DELETE`, participants and standings: one 404 for "no such contest" and "not managed by this client", so the answer never tells which hidden or private keys exist. */
  async require(
    client: ServiceClientPrincipal,
    key: string,
  ): Promise<ContestDocument> {
    const contest = await this.contests.findByKey(key);
    if (!contest || !isManagedBy(contest, client))
      throw new AppError('not_found', 404, 'No such contest');
    return contest;
  }
}
