import { ApiProperty } from '@nestjs/swagger';
import { GHOST_CSV_MAX_BYTES, GHOST_GAPS } from '@libs/contests';
import type { GhostGap } from '@libs/contests';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class ImportGhostsDto {
  /**
   * The ghost CSV: a header row with label, caption and the contest problem
   * codes, then one row per ghost. A cell is empty for an unsolved problem, or
   * minute, optionally prefixed with points and an at sign and suffixed with a
   * plus sign and the rejected tries, for example `12.5@47+2`.
   */
  @IsString()
  @MaxLength(GHOST_CSV_MAX_BYTES)
  csv!: string;
  /** Replace every label by "Ghost 001", ...: labels may be real students' names. */
  @IsOptional() @IsBoolean() anonymize?: boolean;
  /** Validate and preview without storing. */
  @IsOptional() @IsBoolean() dryRun?: boolean;
}

export class GhostCellResponse {
  /** Code of the problem the cell is for. */
  problemCode!: string;
  /** Minute of the contest at which the ghost solved the problem. */
  minute!: number;
  /**
   * Rejected attempts before the accepted one; null when the format does not
   * count them.
   */
  rejectedBefore!: number | null;
  /** Points earned; null when the format keeps none. */
  points!: number | null;
}

export class GhostResponse {
  /** Name shown for the ghost. */
  label!: string;
  /** Secondary text shown with the label. */
  caption!: string;
  /** Derived from the contest's format on every read; unranked ghosts are shown last. */
  isUnranked!: boolean;
  /** R3: `GhostGap` is a union alias, which the plugin drops without an explicit enum. */
  @ApiProperty({ enum: GHOST_GAPS, enumName: 'GhostGap', nullable: true })
  gap!: GhostGap | null;
  /** The ghost's cells, one per solved problem. */
  cells!: GhostCellResponse[];
}

export class GhostListResponse {
  /** Every ghost of the contest. */
  ghosts!: GhostResponse[];
}

export class GhostImportResponse {
  /** False for a `dryRun`. */
  stored!: boolean;
  /** The ghosts parsed from the CSV. */
  ghosts!: GhostResponse[];
}
