import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { PageMetaResponse } from '@libs/common';
import { ContestKeyParamDto } from '../../core/dto/contest-params.dto';

export const BALLOON_STATES = ['pending', 'delivered', 'all'] as const;
export type BalloonState = (typeof BALLOON_STATES)[number];

export class BalloonQueryDto {
  /** Which balloons to list; pending by default. */
  @ApiPropertyOptional({ enum: BALLOON_STATES, enumName: 'BalloonState' })
  @IsOptional()
  @IsIn(BALLOON_STATES)
  state: BalloonState = 'pending';

  /** 1-based page number. */
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  page: number = 1;

  /** Balloons per page, 1 to 100. */
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize: number = 50;
}

export class BalloonItemParamDto extends ContestKeyParamDto {
  /** Id of the team's participation. */
  @IsUUID('7') participation!: string;
  /** Id of the solved problem. */
  @IsUUID('7') problem!: string;
}

export class BalloonTeamResponse {
  userId!: string;
  username!: string;
}

export class BalloonResponse {
  participationId!: string;
  problemId!: string;
  problemCode!: string;
  /** The problem's label in the contest, such as A or B. */
  problemLabel!: string;
  team!: BalloonTeamResponse;
  /** Seconds from the team's start; null when the format keeps no solve time, and for a reader who cannot edit while the contest is frozen. */
  @ApiProperty({ type: Number, nullable: true })
  solvedAt!: number | null;
  /** True when this team was the first to solve the problem. */
  isFirst!: boolean;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  deliveredAt!: string | null;
  /** Username of the volunteer who delivered it. */
  @ApiProperty({ type: String, nullable: true })
  deliveredBy!: string | null;
}

/** Page meta plus the badge counts; both are null for a reader who cannot edit while the contest is frozen. */
export class BalloonPageMetaResponse extends PageMetaResponse {
  @ApiProperty({ type: Number, nullable: true })
  pendingTotal!: number | null;
  @ApiProperty({ type: Number, nullable: true })
  deliveredTotal!: number | null;
}
