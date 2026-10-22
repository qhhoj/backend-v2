import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { ApiPropertyOptions } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { OPAQUE_JSON_OBJECT, LowercaseUuid } from '@libs/common';
import { GHOST_GAPS } from '@libs/contests';
import type { GhostGap, ReplayEvent } from '@libs/contests';

/** R2: a property with an initializer is written with its type and `@ApiPropertyOptional()`, or the plugin documents `Object`. */
export class ReplayQueryDto {
  /** Chunk index, 0 first (it also carries participants, problems and ghosts). */
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100000)
  chunk: number = 0;

  /** The `buildId` chunk 0 returned; required for `chunk > 0`, so a reader never mixes builds. */
  @IsOptional() @LowercaseUuid() @IsUUID() build?: string;
}

/** `[seconds, participantIndex, problemIndex, cell, score, cumtime, tiebreaker]`: numbers around one cell object, whose members belong to the format (free-form here, never an empty `items`). */
const REPLAY_EVENTS_SCHEMA: ApiPropertyOptions = {
  type: 'array',
  items: {
    type: 'array',
    items: { oneOf: [{ type: 'number' }, { ...OPAQUE_JSON_OBJECT }] },
  },
};

export class ReplayUserResponse {
  id!: string;
  username!: string;
  /** Rating, null while unrated. */
  rating!: number | null;
  /** Short name of the user's first listed organization, else null. */
  organization!: string | null;
}

/** At the position of its `participantIndex`. */
export class ReplayParticipantResponse {
  /** Id of the participation. */
  participationId!: string;
  user!: ReplayUserResponse;
}

/** At the position of its `problemIndex`. */
export class ReplayProblemResponse {
  problemId!: string;
  code!: string;
  /** The problem's label in the contest. */
  label!: string;
  /** Points the problem is worth. */
  points!: number;
}

/** A ghost's own stream; its events carry its position as `participantIndex`. */
export class ReplayGhostResponse {
  /** Name shown for the ghost. */
  label!: string;
  /** Secondary text shown with the label. */
  caption!: string;
  /** Whether the ghost is shown outside the ranking. */
  isUnranked!: boolean;
  /** Same named enum as `GhostResponse.gap`; R3: an alias of a union needs the explicit decorator. */
  @ApiProperty({ enum: GHOST_GAPS, enumName: 'GhostGap', nullable: true })
  gap!: GhostGap | null;
  /** The ghost's events, in the same shape as the participants' events. */
  @ApiProperty(REPLAY_EVENTS_SCHEMA)
  events!: ReplayEvent[];
}

export class ReplayResponse {
  /** `building`: a build is queued or running; retry in a few seconds. */
  state!: 'ready' | 'building';
  /** The build every later chunk request must send as `build`; null while building. */
  buildId!: string | null;
  /** When the replay was built, ISO 8601; null while building. */
  builtAt!: string | null;
  /** Index of this chunk. */
  chunk!: number;
  /** Number of chunks in the build. */
  chunkCount!: number;
  /** Chunk 0 only; explicit, so the plugin does not lose the element class behind `| null`. */
  @ApiProperty({ type: () => [ReplayParticipantResponse], nullable: true })
  participants!: ReplayParticipantResponse[] | null;
  /** Problems in the order that events index; chunk 0 only, else null. */
  @ApiProperty({ type: () => [ReplayProblemResponse], nullable: true })
  problems!: ReplayProblemResponse[] | null;
  /** Ghost streams; chunk 0 only, else null. */
  @ApiProperty({ type: () => [ReplayGhostResponse], nullable: true })
  ghosts!: ReplayGhostResponse[] | null;
  /** Seconds from the participation's own start; see `REPLAY_EVENTS_SCHEMA` for the tuple. */
  @ApiProperty(REPLAY_EVENTS_SCHEMA)
  events!: ReplayEvent[];
}
