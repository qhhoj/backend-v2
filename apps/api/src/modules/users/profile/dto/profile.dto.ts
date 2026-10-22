import { LowercaseUuid } from '@libs/common';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
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

/** Theme ids are owned by the SPA's registry (unknown ids fall back to the OS scheme), so the API checks the shape only. */
export const SITE_THEME_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;
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
  'red',
] as const;
export type AppearanceAccent = (typeof APPEARANCE_ACCENTS)[number];
/** The only profile field a PATCH may set to `null`: the site's look. */
export const NULLABLE_PROFILE_FIELDS = ['appearance'];

/** Whole numbers 0-100: the plugin would type them as `number`. */
export const PERCENT_SCHEMA = {
  type: 'integer',
  minimum: 0,
  maximum: 100,
} as const;

export class AppearanceDto {
  /** Accent colour preset. */
  @IsIn(APPEARANCE_ACCENTS) accent!: AppearanceAccent;
  /** Glass effect strength, 0-100. */
  @ApiProperty(PERCENT_SCHEMA) @IsInt() @Min(0) @Max(100) glass!: number;
  /** Glow effect strength, 0-100. */
  @ApiProperty(PERCENT_SCHEMA) @IsInt() @Min(0) @Max(100) glow!: number;
}

/** Most roaming Bits a viewer may ask for (the frontend caps phones lower). */
export const BIT_ROAM_MAX_COUNT = 5;
export const BIT_ROAM_COUNT_SCHEMA = {
  type: 'integer',
  minimum: 1,
  maximum: BIT_ROAM_MAX_COUNT,
} as const;

export class BitRoamDto {
  @IsBoolean() on!: boolean;
  @ApiProperty(BIT_ROAM_COUNT_SCHEMA)
  @IsInt()
  @Min(1)
  @Max(BIT_ROAM_MAX_COUNT)
  count!: number;
}

/** Legacy `ProfileForm` fields; every one optional. */
export class UpdateProfileDto {
  /** About-me text in Markdown, rendered and sanitised on save. */
  @IsOptional() @IsString() @MaxLength(ABOUT_MAX_LENGTH) about?: string;
  /** Display first name, up to 30 characters. */
  @IsOptional()
  @IsString()
  @MaxLength(FIRST_NAME_MAX_LENGTH)
  firstName?: string;
  /** IANA time zone name used to show dates, for example `Asia/Ho_Chi_Minh`. */
  @IsOptional() @IsTimeZone() timezone?: string;
  /** Id of the default programming language. */
  @IsOptional() @LowercaseUuid() @IsUUID('7') languageId?: string;
  /** Site theme id; unknown ids fall back to the operating system scheme. */
  @IsOptional() @Matches(SITE_THEME_PATTERN) siteTheme?: string;
  /** The whole look replaces the stored one; `null` clears it (the site's look). */
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => AppearanceDto)
  appearance?: AppearanceDto | null;
  /** Replaces the stored switch and count. */
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => BitRoamDto)
  bitRoam?: BitRoamDto;
  /** The current memberships reordered or shortened. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @LowercaseUuid()
  @IsUUID('7', { each: true })
  organizations?: string[];
}
