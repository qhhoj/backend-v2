import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
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
/** Theme ids are owned by the SPA's registry (unknown ids fall back to the OS scheme), so the API checks the shape only. */
export const SITE_THEME_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;
export const MATH_ENGINES = ['tex', 'svg', 'mml', 'jax', 'auto'] as const;
/** Legacy `user_script` max_length. */
export const USER_SCRIPT_MAX_LENGTH = 65_536;
/** Legacy `first_name` max_length. */
export const FIRST_NAME_MAX_LENGTH = 30;
/** The frontend's accent presets (frontend `src/theme/appearance.ts`); mode stays in `siteTheme`. */
export const APPEARANCE_ACCENTS = [
  'clay',
  'orchid',
  'ocean',
  'mint',
  'sunset',
  'gold',
  'mono',
] as const;
export type AppearanceAccent = (typeof APPEARANCE_ACCENTS)[number];
/** The only profile fields a PATCH may set to `null`: no badge, the site's look. */
export const NULLABLE_PROFILE_FIELDS = ['displayBadgeId', 'appearance'];

/** Whole numbers 0-100: the plugin would type them as `number`. */
export const PERCENT_SCHEMA = {
  type: 'integer',
  minimum: 0,
  maximum: 100,
} as const;

export class AppearanceDto {
  @IsIn(APPEARANCE_ACCENTS) accent!: AppearanceAccent;
  @ApiProperty(PERCENT_SCHEMA) @IsInt() @Min(0) @Max(100) glass!: number;
  @ApiProperty(PERCENT_SCHEMA) @IsInt() @Min(0) @Max(100) glow!: number;
}

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
  @IsOptional() @Matches(SITE_THEME_PATTERN) siteTheme?: string;
  @IsOptional() @IsIn(MATH_ENGINES) mathEngine?: string;
  @IsOptional()
  @IsString()
  @MaxLength(USER_SCRIPT_MAX_LENGTH)
  userScript?: string;
  @IsOptional() @IsUUID('7') displayBadgeId?: string | null;
  /** The whole look replaces the stored one; `null` clears it (the site's look). */
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => AppearanceDto)
  appearance?: AppearanceDto | null;
  /** The current memberships reordered or shortened. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID('7', { each: true })
  organizations?: string[];
}
