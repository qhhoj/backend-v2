import { Injectable, Logger } from '@nestjs/common';
import type { ServiceClientPrincipal } from '@libs/auth';
import type { SyncParticipantsResponse } from './dto/sync-participants.response';
import { SyncContestOwnership } from './sync-contest-ownership.service';
import { SyncParticipantsRepository } from './sync-participants.repository';
import { SyncRateLimit } from './sync-rate-limit.service';

@Injectable()
export class SyncParticipantsService {
  private readonly logger = new Logger(SyncParticipantsService.name);

  constructor(
    private readonly ownership: SyncContestOwnership,
    private readonly participants: SyncParticipantsRepository,
    private readonly rateLimit: SyncRateLimit,
  ) {}

  /** Allowed at any time for an owned contest, published or started: the participant list is what the external system keeps in step. */
  async replace(
    client: ServiceClientPrincipal,
    key: string,
    usernames: string[],
  ): Promise<SyncParticipantsResponse> {
    await this.rateLimit.charge(client);
    const contest = await this.ownership.require(client, key);
    const { ids, unknown } =
      await this.participants.resolveUsernames(usernames);
    await this.participants.setContestants(contest._id, ids);
    this.logger.log(
      JSON.stringify({
        event: 'sync.contest.participants',
        client: client.clientId,
        key,
        applied: ids.length,
      }),
    );
    return { applied: ids.length, unknown };
  }
}
