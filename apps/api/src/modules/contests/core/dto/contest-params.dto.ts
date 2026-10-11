import { IsString } from 'class-validator';

/** Unvalidated shape: a malformed key is a 404 (see `ContestsService.visibleContest`), never a 400. */
export class ContestKeyParamDto {
  /** Key of the contest. */
  @IsString() key!: string;
}

/** A problem of one contest, by the contest's key and the problem's code; both unvalidated like the single-key shape. */
export class ContestProblemParamsDto extends ContestKeyParamDto {
  /** Code of the problem. */
  @IsString() code!: string;
}
