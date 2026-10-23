import { ApiProperty } from '@nestjs/swagger';
import type { QuotaMeter } from '../../quota/quota.types';

export class QuotaMeterResponse implements QuotaMeter {
  /**
   * Amount used: credits for the credit meter, milliseconds for the judging
   * meter, bytes for the storage meter.
   */
  used!: number;
  /** Amount allowed, in the same unit. */
  limit!: number;
  /** Usage is close to the limit. */
  isNearLimit!: boolean;
  /** Usage is over the limit. */
  isOver!: boolean;
}

export class CreditActorResponse {
  /** Id of the user. */
  id!: string;
  /** Username of the user. */
  username!: string;
}

export class CreditEntryResponse {
  /** What the credits were spent on. */
  reason!: string;
  /** Credits spent; negative for a refund. */
  amount!: number;
  /** Problem code or contest key the spend was for. */
  ref!: string;
  /** The user who spent the credits; null for a system entry or a user that no longer exists. */
  @ApiProperty({ type: CreditActorResponse, nullable: true })
  actor!: CreditActorResponse | null;
  /** When the entry was recorded, ISO 8601. */
  createdAt!: Date;
}

export class UsageTopProblemResponse {
  /** Code of the problem. */
  code!: string;
  /** Name of the problem. */
  name!: string;
  /** Judging milliseconds charged this month. */
  ms!: number;
  /** Grading runs charged this month. */
  runs!: number;
}

export class UsageOrganizationResponse {
  /** Slug of the organization. */
  slug!: string;
  /** Name of the organization. */
  name!: string;
}

/** The staff-set caps; null: the site default applies. */
export class UsageQuotaResponse {
  /** Staff-set monthly credits; null for the site default. */
  @ApiProperty({ type: Number, nullable: true }) monthlyCredits!: number | null;
  /** Staff-set judging milliseconds per month; null for the site default. */
  @ApiProperty({ type: Number, nullable: true }) judgingMs!: number | null;
  /** Staff-set storage cap in bytes; null for the site default. */
  @ApiProperty({ type: Number, nullable: true }) storageBytes!: number | null;
}

export class OrganizationUsageResponse {
  /** The organization. */
  organization!: UsageOrganizationResponse;
  /** `YYYY-MM` in the site time zone. */
  month!: string;
  /** Whether limits are enforced by refusing actions. */
  enforcing!: boolean;
  /** Promotion: the limits below are reported but not applied, and the meters are never near or over. */
  unlimited!: boolean;
  /** Credits used this month against the limit. */
  credits!: QuotaMeterResponse;
  /** Judging milliseconds used this month (site time zone) against the limit. */
  judging!: QuotaMeterResponse;
  /** Problem data storage in bytes against the limit. */
  storage!: QuotaMeterResponse;
  /** The caps staff set for this organization. */
  quota!: UsageQuotaResponse;
  /** The most recent credit entries. */
  recent!: CreditEntryResponse[];
  /** Up to five problems that used the most judging time this month, heaviest first. */
  topProblems!: UsageTopProblemResponse[];
}

export class UsageOverviewRowResponse {
  /** Slug of the organization. */
  slug!: string;
  /** Name of the organization. */
  name!: string;
  /** Month of the figures, YYYY-MM. */
  month!: string;
  /** Credits used this month. */
  creditsUsed!: number;
  /** Credits allowed per month. */
  creditsLimit!: number;
  /** Judging milliseconds used this month. */
  judgingUsed!: number;
  /** Judging milliseconds allowed per month. */
  judgingLimit!: number;
  /** Problem data storage used, in bytes. */
  storageUsed!: number;
  /** Problem data storage allowed, in bytes. */
  storageLimit!: number;
  /** Limits are reported but not applied. */
  unlimited!: boolean;
}
