import { IsUrl, Length, MaxLength } from 'class-validator';

export class CreateTagProblemDto {
  @IsUrl({ require_protocol: true }) @MaxLength(200) link!: string;
  /** Legacy fetched the title from the judge's API; the client supplies it now. */
  @Length(1, 100) name!: string;
}
