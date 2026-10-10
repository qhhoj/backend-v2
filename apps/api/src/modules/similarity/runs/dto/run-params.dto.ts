import { IsString } from 'class-validator';

/** Not checked as a uuid: a malformed id is a 404, like an unknown one. */
export class SimilarityRunParamDto {
  /** Run id. */
  @IsString() runId!: string;
}
