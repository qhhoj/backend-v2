import { ApiProperty } from '@nestjs/swagger';
import type { Contest } from '@libs/database';

const SYNC_UPSERT_ACTIONS = ['created', 'updated', 'unchanged'] as const;
export type SyncUpsertAction = (typeof SYNC_UPSERT_ACTIONS)[number];

export class SyncContestResponse {
  /** Contest key. */
  key!: string;
  /** Contest name. */
  name!: string;
  /** Start time. */
  startTime!: Date;
  /** End time. */
  endTime!: Date;
  /** False until a person publishes it; the sync API cannot change it. */
  isVisible!: boolean;
  /** Users on the contestant list. */
  participantCount!: number;

  static from(
    contest: Pick<
      Contest,
      | 'key'
      | 'name'
      | 'startTime'
      | 'endTime'
      | 'isVisible'
      | 'privateContestants'
    >,
  ): SyncContestResponse {
    return {
      key: contest.key,
      name: contest.name,
      startTime: contest.startTime,
      endTime: contest.endTime,
      isVisible: contest.isVisible,
      participantCount: contest.privateContestants.length,
    };
  }
}

export class SyncUpsertResponse extends SyncContestResponse {
  /** What the request did, or on a dry run what it would do. */
  @ApiProperty({ enum: SYNC_UPSERT_ACTIONS, enumName: 'SyncUpsertAction' })
  action!: SyncUpsertAction;
  /** True when nothing was written (`?dryRun=true`). */
  dryRun!: boolean;
}
