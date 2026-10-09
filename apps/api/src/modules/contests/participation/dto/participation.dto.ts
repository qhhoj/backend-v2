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

export class ParticipationListQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  page: number = 1;
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
  @IsBoolean() disqualified!: boolean;
}

/** Unvalidated shape: a malformed id is a 404. */
export class ParticipationParamsDto {
  @IsString() key!: string;
  @IsString() id!: string;
}
