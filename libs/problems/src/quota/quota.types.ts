import type { QuotaMeterName } from '@libs/database';

export type ChargeKind = 'problem' | 'contest' | 'upload';

export interface ChargeRequest {
  kind: ChargeKind;
  userId: string;
  /** Problem code or contest key, for the ledger. */
  ref: string;
  /** Upload size; only `upload` charges read it. */
  bytes?: number;
}

/** One organization's month of credits. */
export interface UsageKey {
  organizationId: string;
  month: string;
}

export type PricedCharge = ChargeRequest & { amount: number };

/** What a spend took, as recorded: carried by work that finishes elsewhere (a Polygon import job) so the credits can be given back to the same month. */
export type SpentCharge = UsageKey & PricedCharge;

/** `unlimited`: the limits are reported but never applied. */
export interface EffectiveLimits {
  credits: number;
  storageBytes: number;
  unlimited: boolean;
}

export interface QuotaRefusal {
  meter: QuotaMeterName;
  limit: number;
  used: number;
  needed: number;
}
