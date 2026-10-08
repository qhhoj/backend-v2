import { codePointLength, MAX_SOURCE_LENGTH } from '@libs/database';
import { IsString, registerDecorator } from 'class-validator';
import { SubmitFileDto } from './submit-file.dto';

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

export class SubmitDto extends SubmitFileDto {
  @IsString() @IsSourceLength() source!: string;
}
