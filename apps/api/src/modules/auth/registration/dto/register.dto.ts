import { MAIL_ADDRESS_PATTERN } from '@libs/common';
import {
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RegisterDto {
  /** Desired login name: letters, digits and underscores, up to 30 characters. */
  @Matches(/^\w+$/, {
    message: 'A username must contain letters, numbers, or underscores.',
    context: { code: 'username_invalid_characters' },
  })
  @MaxLength(30)
  username!: string;

  /** Email address for the activation link and password resets, up to 254 characters. */
  @Matches(MAIL_ADDRESS_PATTERN, {
    message: 'Enter a valid email address.',
    context: { code: 'email_invalid' },
  })
  @MaxLength(254)
  email!: string;

  /**
   * Account password; must pass the password policy and not appear in a known breach.
   */
  @IsString() @MinLength(1) @MaxLength(4096) password!: string;

  /** An open, listed organization the new account joins. */
  @IsOptional() @IsUUID('7') organizationId?: string;

  /** The account's default programming language. */
  @IsOptional() @IsUUID('7') languageId?: string;
}
