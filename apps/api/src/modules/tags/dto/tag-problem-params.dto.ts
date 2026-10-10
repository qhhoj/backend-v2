import { IsString } from 'class-validator';

/** Unvalidated shape: a malformed code is a 404 (see `TagsService.existing`), never a 400. */
export class TagProblemCodeParamDto {
  /** Code of the tagged problem. */
  @IsString() code!: string;
}
