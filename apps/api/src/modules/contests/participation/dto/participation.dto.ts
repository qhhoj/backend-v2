import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class AccessCodeDto {
  @IsOptional() @IsString() @MaxLength(255) accessCode?: string;
}

/** Body of register and join: the access code and the rules acceptance a new participation needs. */
export class JoinBodyDto extends AccessCodeDto {
  @IsOptional() @IsBoolean() acceptRules?: boolean;
}

export class ParticipationListQueryDto {
  /** 1-based page number. */
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  page: number = 1;
  /** Participations per page, 1 to 100. */
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize: number = 50;
  /** Username; others than the viewer need edit rights. */
  @IsOptional() @IsString() @MaxLength(30) user?: string;
}

export class DisqualifyDto {
  /** True to disqualify the participation, false to reinstate it. */
  @IsBoolean() disqualified!: boolean;
}

/** Unvalidated shape: a malformed id is a 404. */
export class ParticipationParamsDto {
  /** Key of the contest. */
  @IsString() key!: string;
  /** Id of the participation. */
  @IsString() id!: string;
}
