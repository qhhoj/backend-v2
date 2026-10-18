import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { toArray } from '@libs/common';
import { toBoolean, trim } from '../../../problems/core/dto/transforms';

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
  /** true keeps open tickets whose newest message is not from staff (what the staff badge counts). */
  @IsOptional() @Transform(toBoolean) @IsBoolean() awaiting?: boolean;
  /** true limits the list to tickets the caller filed or is assigned to. */
  @IsOptional() @Transform(toBoolean) @IsBoolean() own?: boolean;
  /** true limits the list to tickets about what the caller makes: problems they author, curate or suggested, and contests they author or curate (tickets filed from them), whatever else they may read. */
  @IsOptional() @Transform(toBoolean) @IsBoolean() aboutMine?: boolean;
  /** Text in the title (ignoring case and Vietnamese accents), or the exact username of the creator; blank filters nothing. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  @Matches(/^[^\0]*$/)
  // eslint-disable-next-line id-length -- the wire name, shared with the problem and contest lists
  q?: string;
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
