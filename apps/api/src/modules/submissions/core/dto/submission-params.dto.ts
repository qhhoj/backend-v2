import { IsString } from 'class-validator';

/** Unvalidated shape: a malformed id is a 404, like an unknown one. */
export class SubmissionIdParamDto {
  @IsString() id!: string;
}
