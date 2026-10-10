import { ApiPropertyOptional } from '@nestjs/swagger';
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
  /** Hostname-style: the judge sends it as `x-judge-name` metadata when it opens the judge link. */
  @IsString()
  @Matches(JUDGE_NAME_PATTERN, {
    message: 'Use letters, digits, "_", "." or "-" (at most 50).',
  })
  name!: string;
  /** Free-form notes about the judge, up to 10000 characters. */
  @IsOptional()
  @IsString()
  @MaxLength(MAX_DESCRIPTION_LENGTH)
  description?: string;
}

export class UpdateJudgeDto {
  /** true disconnects the judge and refuses it until unblocked. */
  @IsOptional() @IsBoolean() isBlocked?: boolean;
  /** true tells the judge to stop taking new work. */
  @IsOptional() @IsBoolean() isDisabled?: boolean;
  /** Free-form notes about the judge, up to 10000 characters. */
  @IsOptional()
  @IsString()
  @MaxLength(MAX_DESCRIPTION_LENGTH)
  description?: string;
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
