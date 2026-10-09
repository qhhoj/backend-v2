import { ApiProperty } from '@nestjs/swagger';
import { GHOST_CSV_MAX_BYTES, GHOST_GAPS } from '@libs/contests';
import type { GhostGap } from '@libs/contests';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class ImportGhostsDto {
  @IsString()
  @MaxLength(GHOST_CSV_MAX_BYTES)
  csv!: string;
  /** Replace every label by "Ghost 001", ...: labels may be real students' names. */
  @IsOptional() @IsBoolean() anonymize?: boolean;
  /** Validate and preview without storing. */
  @IsOptional() @IsBoolean() dryRun?: boolean;
}

export class GhostCellResponse {
  problemCode!: string;
  minute!: number;
  rejectedBefore!: number | null;
  points!: number | null;
}

export class GhostResponse {
  label!: string;
  caption!: string;
  /** Derived from the contest's format on every read; unranked ghosts are shown last. */
  isUnranked!: boolean;
  /** R3: `GhostGap` is a union alias, which the plugin drops without an explicit enum. */
  @ApiProperty({ enum: GHOST_GAPS, enumName: 'GhostGap', nullable: true })
  gap!: GhostGap | null;
  cells!: GhostCellResponse[];
}

export class GhostListResponse {
  ghosts!: GhostResponse[];
}

export class GhostImportResponse {
  /** False for a `dryRun`. */
  stored!: boolean;
  ghosts!: GhostResponse[];
}
