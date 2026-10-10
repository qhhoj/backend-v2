import { IsString } from 'class-validator';

/** Unvalidated shape: a malformed key is a 404 (see `ContestsService.visibleContest`), never a 400. */
export class ContestKeyParamDto {
  /** Key of the contest. */
  @IsString() key!: string;
}
