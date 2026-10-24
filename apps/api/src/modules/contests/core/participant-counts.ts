import type Redis from 'ioredis';
import { runCoalesced } from '@libs/common';
import type { ContestsRepository } from './contests.repository';
import type { ParticipationsRepository } from './participations.repository';

export interface ParticipantCountStores {
  contests: Pick<ContestsRepository, 'setCounts'>;
  participations: Pick<ParticipationsRepository, 'countsOf'>;
}

/** Recounts a contest's live and virtual participants and stores the counts, coalesced per contest (`runCoalesced`), so parallel joins and leaves cannot store their counts out of order. */
export async function recountParticipants(
  redis: Redis,
  stores: ParticipantCountStores,
  contestId: string,
): Promise<void> {
  await runCoalesced(redis, `contest-counts:${contestId}`, async () =>
    stores.contests.setCounts(
      contestId,
      await stores.participations.countsOf(contestId),
    ),
  );
}
