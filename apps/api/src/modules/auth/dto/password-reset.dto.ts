import { MAIL_ADDRESS_PATTERN } from '@libs/common';
import {
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class PasswordResetRequestDto {
  @Matches(MAIL_ADDRESS_PATTERN, { message: 'Enter a valid email address.' })
  @MaxLength(254)
  email!: string;
}

export class PasswordResetConfirmDto {
  @IsString() @Length(1, 512) token!: string;
  @IsString() @MinLength(1) @MaxLength(4096) newPassword!: string;
}
