import { ApiProperty } from '@nestjs/swagger';
import type { QuotaMeter } from '../../quota/quota.types';

export class QuotaMeterResponse implements QuotaMeter {
  used!: number;
  limit!: number;
  isNearLimit!: boolean;
  isOver!: boolean;
}

export class CreditActorResponse {
  id!: string;
  username!: string;
}

export class CreditEntryResponse {
  reason!: string;
  amount!: number;
  ref!: string;
  /** The user who spent the credits; null for a system entry or a user that no longer exists. */
  @ApiProperty({ type: CreditActorResponse, nullable: true })
  actor!: CreditActorResponse | null;
  createdAt!: Date;
}

export class UsageOrganizationResponse {
  slug!: string;
  name!: string;
}

/** The staff-set caps; null: the site default applies. */
export class UsageQuotaResponse {
  @ApiProperty({ type: Number, nullable: true }) monthlyCredits!: number | null;
  @ApiProperty({ type: Number, nullable: true }) storageBytes!: number | null;
}

export class OrganizationUsageResponse {
  organization!: UsageOrganizationResponse;
  /** `YYYY-MM` in the site time zone. */
  month!: string;
  enforcing!: boolean;
  credits!: QuotaMeterResponse;
  storage!: QuotaMeterResponse;
  quota!: UsageQuotaResponse;
  recent!: CreditEntryResponse[];
}

export class UsageOverviewRowResponse {
  slug!: string;
  name!: string;
  month!: string;
  creditsUsed!: number;
  creditsLimit!: number;
  storageUsed!: number;
  storageLimit!: number;
}
