import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayUnique,
  Equals,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ABOUT_MAX_LENGTH } from '@libs/community';
import { CurrentPasswordDto } from '../../../auth/core/dto/current-password.dto';
import { trim } from '../../../problems/core/dto/transforms';
import { IsMailAddress } from '../../core/dto/email';
import { IsUsername } from '../../core/dto/username';
import { FIRST_NAME_MAX_LENGTH } from '../../profile/dto/profile.dto';

/** Legacy `username_display_override` max_length. */
export const DISPLAY_NAME_MAX_LENGTH = 100;
/** Legacy `VNOJ_DISPLAY_RANKS` without `banned`, which only the ban route sets. */
export const STAFF_DISPLAY_RANKS = [
  'user',
  'setter',
  'daor',
  'staff',
  'admin',
  'teacher',
] as const;
export const STAFF_NOTES_MAX_LENGTH = 4096;

/** Absent fields stay unchanged; `null` is refused. */
export class UpdateUserByStaffDto {
  /** Name shown in place of the username, up to 100 characters; empty shows the username. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(DISPLAY_NAME_MAX_LENGTH)
  displayName?: string;
  /** The user's full name, up to 30 characters. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(FIRST_NAME_MAX_LENGTH)
  fullName?: string;
  /** About-me text in Markdown, rendered and sanitised on save. */
  @IsOptional() @IsString() @MaxLength(ABOUT_MAX_LENGTH) about?: string;
  /** New e-mail address (needs `auth.change_user`); surrounding spaces are dropped and the domain lower-cased. */
  @IsOptional()
  @Transform(trim)
  @IsMailAddress()
  email?: string;
  /** Rank title shown beside the name; `banned` is set by the ban route only. */
  @ApiPropertyOptional({
    enum: STAFF_DISPLAY_RANKS,
    enumName: 'StaffDisplayRank',
  })
  @IsOptional()
  @IsIn(STAFF_DISPLAY_RANKS)
  displayRank?: (typeof STAFF_DISPLAY_RANKS)[number];
  /** Hidden from the leaderboards and member lists. */
  @IsOptional() @IsBoolean() isUnlisted?: boolean;
  /** Muted users cannot write comments or posts. */
  @IsOptional() @IsBoolean() mute?: boolean;
  /** Whether the user may tag problems they solved. */
  @IsOptional() @IsBoolean() allowTagging?: boolean;
  /** Notes for staff only, up to 4096 characters; never shown to the user. */
  @IsOptional()
  @IsString()
  @MaxLength(STAFF_NOTES_MAX_LENGTH)
  notes?: string;
  /** `true` takes the user out of the contest they are in (legacy `current_contest` cleared). */
  @IsOptional() @Equals(true) leaveCurrentContest?: true;
  /** Activate or deactivate the account (needs `auth.change_user`); deactivating signs the user out everywhere and revokes the API token. A banned account is unbanned through its own route. */
  @IsOptional() @IsBoolean() isActive?: boolean;
  /** Your own password; required with an `email` change, like a password set. */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  currentPassword?: string;
  /** The complete, ordered list of organization ids the user belongs to. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID('7', { each: true })
  organizations?: string[];
}

export class SetUserPasswordDto extends CurrentPasswordDto {
  /** The user's new password; it must pass the password policy. */
  @IsString() @MinLength(1) @MaxLength(4096) newPassword!: string;
}

export class RenameUserDto {
  /** The new login name: letters, digits and underscores, up to 30 characters. */
  @IsUsername() username!: string;
}
