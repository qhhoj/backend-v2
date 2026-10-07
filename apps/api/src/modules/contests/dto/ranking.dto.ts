import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { toBoolean } from '../../problems/dto/transforms';

export class RankingQueryDto {
  /** Include virtual participations. */
  @IsOptional() @Transform(toBoolean) @IsBoolean() virtual = false;
  /** The contest's ranking access code: shows the full board whatever the scoreboard rules. */
  @IsOptional() @IsString() @MaxLength(255) code?: string;
}
