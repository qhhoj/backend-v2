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
import { toArray, toBoolean } from '../../../problems/core/dto/transforms';

export class TicketPageQueryDto {
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
  @IsOptional() @Transform(toBoolean) @IsBoolean() open?: boolean;
  @IsOptional() @Transform(toBoolean) @IsBoolean() own?: boolean;
  @IsOptional()
  @Transform(toArray)
  @ArrayMaxSize(10)
  @IsString({ each: true })
  user?: string[];
  @IsOptional()
  @Transform(toArray)
  @ArrayMaxSize(10)
  @IsString({ each: true })
  assignee?: string[];
}
