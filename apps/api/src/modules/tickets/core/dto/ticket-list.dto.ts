import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { toArray } from '@libs/common';
import { toBoolean } from '../../../problems/core/dto/transforms';

export class TicketPageQueryDto {
  /** 1-based page number. */
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  page: number = 1;
}

/** Legacy `TicketList` filters; `user` and `assignee` repeat (`user=a&user=b`) and are usernames. */
export class TicketListQueryDto extends TicketPageQueryDto {
  /** true for open tickets only, false for closed only, absent for both. */
  @IsOptional() @Transform(toBoolean) @IsBoolean() open?: boolean;
  /** true limits the list to tickets the caller filed or is assigned to. */
  @IsOptional() @Transform(toBoolean) @IsBoolean() own?: boolean;
  /** Usernames of ticket creators; repeat the parameter, at most 10. */
  @IsOptional()
  @Transform(toArray)
  @ArrayMaxSize(10)
  @IsString({ each: true })
  user?: string[];
  /** Usernames of assignees; repeat the parameter, at most 10. */
  @IsOptional()
  @Transform(toArray)
  @ArrayMaxSize(10)
  @IsString({ each: true })
  assignee?: string[];
}
