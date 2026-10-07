import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { toBoolean } from '../../problems/core/dto/transforms';
import { API_V2_MAX_PAGE } from './api-v2-problem-list.dto';

/** Basic filters read one value; a repeated key takes the last, like Django's `QueryDict.get`. */
const lastValue = ({ value }: { value: unknown }): unknown =>
  Array.isArray(value) ? (value as unknown[]).at(-1) : value;

/** Legacy `APIContestParticipationList` filters. */
export class ApiV2ParticipationListDto {
  /** Contest key; an over-long one matches nothing, as in legacy. */
  @IsOptional()
  @Transform(lastValue)
  @IsString()
  @Matches(/^[^\0]*$/)
  contest?: string;
  /** Username. */
  @IsOptional()
  @Transform(lastValue)
  @IsString()
  @Matches(/^[^\0]*$/)
  user?: string;
  @IsOptional()
  @Transform(({ value }) => toBoolean({ value: lastValue({ value }) }))
  @IsBoolean()
  is_disqualified?: boolean;
  @IsOptional()
  @Transform(lastValue)
  @Type(() => Number)
  @IsInt()
  @Min(-1)
  virtual_participation_number?: number;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(API_V2_MAX_PAGE)
  page = 1;
}
