import { JUDGE_NAME_PATTERN } from '@libs/database';
import { IsOptional, IsString, IsUUID, Matches } from 'class-validator';

/** The fields of both submit routes besides the source; the file route reads them from its multipart form. */
export class SubmitFileDto {
  /** Language id; must be one of the problem's allowed languages. */
  @IsUUID('7') language!: string;
  /** Name of the judge to use (legacy `judge-id`); problem editors only. */
  @IsOptional() @IsString() @Matches(JUDGE_NAME_PATTERN) judgeId?: string;
}

/** The multipart text fields `POST .../submit/file` accepts next to `file`. */
export const SUBMIT_FILE_FIELDS = ['language', 'judgeId'] as const;
