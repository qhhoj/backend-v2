import { MAIL_ADDRESS_PATTERN } from '@libs/common';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  @Matches(/^\w+$/, {
    message: 'A username must contain letters, numbers, or underscores.',
    context: { code: 'username_invalid_characters' },
  })
  @MaxLength(30)
  username!: string;

  @Matches(MAIL_ADDRESS_PATTERN, {
    message: 'Enter a valid email address.',
    context: { code: 'email_invalid' },
  })
  @MaxLength(254)
  email!: string;

  @IsString() @MinLength(1) @MaxLength(4096) password!: string;
}
