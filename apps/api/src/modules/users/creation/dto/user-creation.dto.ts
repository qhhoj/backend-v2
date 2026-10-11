import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { trim } from '../../../problems/core/dto/transforms';
import { Transform } from 'class-transformer';
import { IsMailAddress } from '../../core/dto/email';
import { IsUsername } from '../../core/dto/username';
import { FIRST_NAME_MAX_LENGTH } from '../../profile/dto/profile.dto';

/** Rows per batch request: each row hashes a password, so larger imports are sent in several requests. */
export const USER_BATCH_MAX = 100;

export class NewUserDto {
  /** Login name: letters, digits and underscores, up to 30 characters. */
  @IsUsername() username!: string;
  /** Full name, up to 30 characters. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(FIRST_NAME_MAX_LENGTH)
  fullName?: string;
  /** E-mail address; required for an invite. */
  @IsOptional()
  @Transform(trim)
  @IsMailAddress()
  email?: string;
  /** Initial password; it must pass the signup policy. Absent: one is generated (and returned once), unless `invite` is set. */
  @IsOptional() @IsString() @MinLength(1) @MaxLength(4096) password?: string;
  /** Mail a link to choose a password instead of setting one (needs `email`, no `password`). */
  @IsOptional() @IsBoolean() invite?: boolean;
}

export class CreateUsersDto {
  /** Up to 100 accounts; each row is created or refused on its own. */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(USER_BATCH_MAX)
  @ValidateNested({ each: true })
  @Type(() => NewUserDto)
  users!: NewUserDto[];
  /** An organization every new account joins (a school import). */
  @IsOptional() @IsUUID('7') organizationId?: string;
}
