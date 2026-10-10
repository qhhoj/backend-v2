import { Transform } from 'class-transformer';
import { IsUrl, Length, MaxLength } from 'class-validator';

import { trim } from '../../problems/core/dto/transforms';

export class CreateTagProblemDto {
  /** URL of the problem on a supported judge; the problem code and judge are derived from it. */
  @IsUrl({ require_protocol: true }) @MaxLength(200) link!: string;
  /** Legacy fetched the title from the judge's API; the client supplies it now. */
  @Transform(trim) @Length(1, 100) name!: string;
}
