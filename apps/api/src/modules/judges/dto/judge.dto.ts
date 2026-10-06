import { JUDGE_NAME_PATTERN } from '@libs/database';
import {
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

const MAX_DESCRIPTION_LENGTH = 10000;

export class CreateJudgeDto {
  /** Hostname-style: the judge-server sends it as its handshake `id`. */
  @IsString()
  @Matches(JUDGE_NAME_PATTERN, {
    message: 'Use letters, digits, "_", "." or "-" (at most 50).',
  })
  name!: string;
  @IsOptional()
  @IsString()
  @MaxLength(MAX_DESCRIPTION_LENGTH)
  description?: string;
}

export class UpdateJudgeDto {
  @IsOptional() @IsBoolean() isBlocked?: boolean;
  @IsOptional() @IsBoolean() isDisabled?: boolean;
  @IsOptional()
  @IsString()
  @MaxLength(MAX_DESCRIPTION_LENGTH)
  description?: string;
}

export class DisconnectJudgeDto {
  @IsOptional() @IsBoolean() force = false;
}

/** Unvalidated shape: a malformed name is a 404, like an unknown one. */
export class JudgeNameParamDto {
  @IsString() name!: string;
}
