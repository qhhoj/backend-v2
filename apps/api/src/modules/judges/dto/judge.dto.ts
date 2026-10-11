import { ApiPropertyOptional } from '@nestjs/swagger';
import { JUDGE_BLOCK_REASON_MAX, JUDGE_NAME_PATTERN } from '@libs/database';
import {
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

const MAX_DESCRIPTION_LENGTH = 10000;
const NAME_RULE = {
  message: 'Use letters, digits, "_", "." or "-" (at most 50).',
};

export class CreateJudgeDto {
  /** Hostname-style: the judge sends it as `x-judge-name` metadata when it opens the judge link. */
  @IsString()
  @Matches(JUDGE_NAME_PATTERN, NAME_RULE)
  name!: string;
  /** Free-form notes about the judge, up to 10000 characters. */
  @IsOptional()
  @IsString()
  @MaxLength(MAX_DESCRIPTION_LENGTH)
  description?: string;
}

export class UpdateJudgeDto {
  /** true disconnects the judge and refuses it until unblocked; false also clears `blockReason`. */
  @IsOptional() @IsBoolean() isBlocked?: boolean;
  /** Why it is blocked, up to 500 characters; shown to staff only. */
  @IsOptional()
  @IsString()
  @MaxLength(JUDGE_BLOCK_REASON_MAX)
  blockReason?: string;
  /** true tells the judge to stop taking new work. */
  @IsOptional() @IsBoolean() isDisabled?: boolean;
  /** Free-form notes about the judge, up to 10000 characters. */
  @IsOptional()
  @IsString()
  @MaxLength(MAX_DESCRIPTION_LENGTH)
  description?: string;
}

export class RenameJudgeDto {
  /** The new name, hostname-style like at creation; the judge's config must use it to reconnect. */
  @IsString()
  @Matches(JUDGE_NAME_PATTERN, NAME_RULE)
  name!: string;
}

export class DisconnectJudgeDto {
  /** true retires every session and socket of the judge at once. Default false. */
  @ApiPropertyOptional() @IsOptional() @IsBoolean() force: boolean = false;
}

/** Unvalidated shape: a malformed name is a 404, like an unknown one. */
export class JudgeNameParamDto {
  /** Judge name. */
  @IsString() name!: string;
}
