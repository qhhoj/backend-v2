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

/** Theme ids are owned by the SPA's registry (unknown ids fall back to the OS scheme), so the API checks the shape only; retired ids are answered as their successors (`currentSiteTheme`). */
export const SITE_THEME_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;
/** Legacy `first_name` max_length. */
export const FIRST_NAME_MAX_LENGTH = 30;
/** The frontend's accents (frontend `src/theme/appearance.ts`, palette A), picker order; the first is the site's. */
export const APPEARANCE_ACCENTS = [
  'ultramarine',
  'teal',
  'plum',
  'terracotta',
  'graphite',
] as const;
export type AppearanceAccent = (typeof APPEARANCE_ACCENTS)[number];
/** The Clay and Glass accents (retired 2026-11-15) and the accent each one became: accepted from older clients and stored, answered and kept as the new id. */
export const LEGACY_APPEARANCE_ACCENTS = {
  clay: 'terracotta',
  orchid: 'plum',
  ocean: 'ultramarine',
  mint: 'teal',
  sunset: 'terracotta',
  gold: 'terracotta',
  mono: 'graphite',
  red: 'terracotta',
} as const satisfies Record<string, AppearanceAccent>;
export type LegacyAppearanceAccent = keyof typeof LEGACY_APPEARANCE_ACCENTS;
const ACCEPTED_ACCENTS = [
  ...APPEARANCE_ACCENTS,
  ...Object.keys(LEGACY_APPEARANCE_ACCENTS),
];
/** Standard or the high-contrast palette; absent in a look means `standard`. */
export const APPEARANCE_CONTRASTS = ['standard', 'high'] as const;
export type AppearanceContrast = (typeof APPEARANCE_CONTRASTS)[number];
/** The frontend's page-background styles (frontend `src/theme/appearance.ts`); absent in a look means the default, `blueprint`. */
export const APPEARANCE_BACKGROUNDS = [
  'none',
  'paper',
  'grainy',
  'blueprint',
  'contour',
  'halftone',
  'dither',
  'stipple',
  'landscape',
] as const;
export type AppearanceBackground = (typeof APPEARANCE_BACKGROUNDS)[number];
/** The only profile field a PATCH may set to `null`: the site's look. */
export const NULLABLE_PROFILE_FIELDS = ['appearance'];

/** Whole numbers 0-100: the plugin would type them as `number`. */
export const PERCENT_SCHEMA = {
  type: 'integer',
  minimum: 0,
  maximum: 100,
} as const;

export class AppearanceDto {
  /** Accent preset; a retired Clay or Glass id is stored as its successor. */
  @IsIn(ACCEPTED_ACCENTS) accent!: AppearanceAccent | LegacyAppearanceAccent;
  /** Contrast level; omit for `standard`. */
  @IsOptional() @IsIn(APPEARANCE_CONTRASTS) contrast?: AppearanceContrast;
  /** Page background style; omit for the default (`blueprint`). */
  @IsOptional()
  @IsIn(APPEARANCE_BACKGROUNDS)
  background?: AppearanceBackground;
  /** Deprecated (Glass, retired 2026-11-15): accepted from older clients and ignored. */
  @ApiProperty({ ...PERCENT_SCHEMA, required: false, deprecated: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  glass?: number;
  /** Deprecated (Glass, retired 2026-11-15): accepted from older clients and ignored. */
  @ApiProperty({ ...PERCENT_SCHEMA, required: false, deprecated: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  glow?: number;
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
