import { ApiProperty } from '@nestjs/swagger';
import { BIT_ROAM_COUNT_SCHEMA } from './profile.dto';
import { AppearanceResponse } from '../../../accounts/appearance.response';
import type { OrganizationSummaryResponse } from '../../../organizations/core/dto/organization.response';

export class ProfileOrganizationResponse implements OrganizationSummaryResponse {
  /** Organization id. */
  id!: string;
  /** URL slug of the organization. */
  slug!: string;
  /** Full name. */
  name!: string;
  /** Short name shown next to usernames. */
  shortName!: string;
  /** Whether anyone may join without an invitation. */
  isOpen!: boolean;
  /** Whether the caller administers the organization. */
  isAdmin!: boolean;
}

export class BitRoamResponse {
  on!: boolean;
  @ApiProperty(BIT_ROAM_COUNT_SCHEMA) count!: number;
}

export class ProfileResponse {
  /** About-me text in Markdown. */
  about!: string;
  /** Rendered, sanitised HTML of `about`. */
  aboutHtml!: string;
  /** Display first name. */
  firstName!: string;
  /** IANA time zone name used to show dates. */
  timezone!: string;
  /** Default programming language id; null when none. */
  languageId!: string | null;
  /** Site theme id. */
  siteTheme!: string;
  /** The personal look (accent, contrast, page background); null for the site look. */
  appearance!: AppearanceResponse | null;
  /** Roaming Bits: off with one Bit until the user turns them on. */
  bitRoam!: BitRoamResponse;
  /** Organizations the user belongs to, in display order. */
  organizations!: ProfileOrganizationResponse[];
}
