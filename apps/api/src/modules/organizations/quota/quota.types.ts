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

export interface QuotaMeter {
  used: number;
  limit: number;
  isNearLimit: boolean;
  isOver: boolean;
}

export interface QuotaSnapshot {
  month: string;
  enforcing: boolean;
  unlimited: boolean;
  credits: QuotaMeter;
  storage: QuotaMeter;
}

export interface QuotaRefusal {
  meter: QuotaMeterName;
  limit: number;
  used: number;
  needed: number;
}
