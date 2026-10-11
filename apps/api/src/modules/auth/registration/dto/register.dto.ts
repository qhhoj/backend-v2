import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { IsMailAddress } from '../../../users/core/dto/email';
import { IsUsername } from '../../../users/core/dto/username';

export class RegisterDto {
  /** Desired login name: letters, digits and underscores, up to 30 characters. */
  @IsUsername()
  username!: string;

  /** Email address for the activation link and password resets, up to 254 characters. */
  @IsMailAddress()
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
