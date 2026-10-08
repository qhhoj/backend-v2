import type { OrganizationSummaryResponse } from '../../../organizations/core/dto/organization.response';

export class ProfileOrganizationResponse implements OrganizationSummaryResponse {
  id!: string;
  slug!: string;
  name!: string;
  shortName!: string;
  isOpen!: boolean;
  isAdmin!: boolean;
}

export class AppearanceResponse {
  accent!: string;
  glass!: number;
  glow!: number;
}

export class ProfileResponse {
  about!: string;
  aboutHtml!: string;
  firstName!: string;
  timezone!: string;
  languageId!: string | null;
  aceTheme!: string;
  siteTheme!: string;
  appearance!: AppearanceResponse | null;
  mathEngine!: string;
  userScript!: string;
  badges!: string[];
  displayBadgeId!: string | null;
  organizations!: ProfileOrganizationResponse[];
}
