import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Min,
} from 'class-validator';

/** Verdicts a judge can give a graded run; CE, IE, AB and RJ have their own paths (rejudge, abort, reject). */
export const OVERRIDE_RESULTS = [
  'AC',
  'WA',
  'TLE',
  'MLE',
  'OLE',
  'IR',
  'RTE',
] as const;
export type OverrideResult = (typeof OVERRIDE_RESULTS)[number];
const MAX_COMMENT_LENGTH = 500;

export class ScoreOverrideDto {
  /** The verdict to show. `AC` needs full points. */
  @ApiProperty({ enum: OVERRIDE_RESULTS, enumName: 'OverrideResult' })
  @IsIn(OVERRIDE_RESULTS)
  result!: OverrideResult;
  /** Points on the problem's scale, 0 to the problem's points (3 decimals); a problem without partial points takes only 0 or full. */
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 3 })
  @Min(0)
  points!: number;
  /** Why, kept in the submission's revision log; 1 to 500 characters. */
  @IsString()
  @Length(1, MAX_COMMENT_LENGTH)
  comment!: string;
  /** true also locks it, so a later rejudge cannot discard the override. Default false. */
  @IsOptional() @IsBoolean() lock?: boolean;
}
