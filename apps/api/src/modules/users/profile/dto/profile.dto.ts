import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { ABOUT_MAX_LENGTH } from '@libs/community';
import { IsTimeZone } from '../../core/dto/is-time-zone';

/** Legacy `judge/models/choices.py`. */
export const ACE_THEMES = [
  'auto',
  'ambiance',
  'chaos',
  'chrome',
  'clouds',
  'clouds_midnight',
  'cobalt',
  'crimson_editor',
  'dawn',
  'dreamweaver',
  'eclipse',
  'github',
  'idle_fingers',
  'katzenmilch',
  'kr_theme',
  'kuroir',
  'merbivore',
  'merbivore_soft',
  'mono_industrial',
  'monokai',
  'pastel_on_dark',
  'solarized_dark',
  'solarized_light',
  'terminal',
  'textmate',
  'tomorrow',
  'tomorrow_night',
  'tomorrow_night_blue',
  'tomorrow_night_bright',
  'tomorrow_night_eighties',
  'twilight',
  'vibrant_ink',
  'xcode',
] as const;
export const SITE_THEMES = ['auto', 'light', 'dark'] as const;
export const MATH_ENGINES = ['tex', 'svg', 'mml', 'jax', 'auto'] as const;
/** Legacy `user_script` max_length. */
export const USER_SCRIPT_MAX_LENGTH = 65_536;
/** Legacy `first_name` max_length. */
export const FIRST_NAME_MAX_LENGTH = 30;
/** The only profile field a PATCH may set to `null` (shows no badge). */
export const NULLABLE_PROFILE_FIELDS = ['displayBadgeId'];

/** Legacy `ProfileForm` fields; every one optional. */
export class UpdateProfileDto {
  @IsOptional() @IsString() @MaxLength(ABOUT_MAX_LENGTH) about?: string;
  @IsOptional()
  @IsString()
  @MaxLength(FIRST_NAME_MAX_LENGTH)
  firstName?: string;
  @IsOptional() @IsTimeZone() timezone?: string;
  @IsOptional() @IsUUID('7') languageId?: string;
  @IsOptional() @IsIn(ACE_THEMES) aceTheme?: string;
  @IsOptional() @IsIn(SITE_THEMES) siteTheme?: string;
  @IsOptional() @IsIn(MATH_ENGINES) mathEngine?: string;
  @IsOptional()
  @IsString()
  @MaxLength(USER_SCRIPT_MAX_LENGTH)
  userScript?: string;
  @IsOptional() @IsUUID('7') displayBadgeId?: string | null;
  /** The current memberships reordered or shortened. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID('7', { each: true })
  organizations?: string[];
}
