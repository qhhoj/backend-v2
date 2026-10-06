import {
  codePointLength,
  JUDGE_NAME_PATTERN,
  MAX_SOURCE_LENGTH,
} from '@libs/database';
import {
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  registerDecorator,
} from 'class-validator';

/** 1 to `MAX_SOURCE_LENGTH` code points, counted exactly as the schema does. */
const IsSourceLength = () => (target: object, propertyName: string) =>
  registerDecorator({
    name: 'isSourceLength',
    target: target.constructor,
    propertyName,
    validator: {
      validate: (value: unknown) =>
        typeof value === 'string' &&
        codePointLength(value) >= 1 &&
        codePointLength(value) <= MAX_SOURCE_LENGTH,
      defaultMessage: () =>
        `source must be between 1 and ${MAX_SOURCE_LENGTH} characters`,
    },
  });

export class SubmitDto {
  /** Language id; must be one of the problem's allowed languages. */
  @IsUUID('all') language!: string;
  @IsString() @IsSourceLength() source!: string;
  /** Name of the judge to use (legacy `judge-id`); problem editors only. */
  @IsOptional() @IsString() @Matches(JUDGE_NAME_PATTERN) judgeId?: string;
}
