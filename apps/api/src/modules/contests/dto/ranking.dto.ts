import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { toBoolean } from '../../problems/dto/transforms';

export class RankingQueryDto {
  /** Include virtual participations. */
  @IsOptional() @Transform(toBoolean) @IsBoolean() virtual = false;
}
