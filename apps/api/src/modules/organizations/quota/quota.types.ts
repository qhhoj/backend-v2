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
  /** Judging milliseconds this month. */
  judging: QuotaMeter;
  storage: QuotaMeter;
}

/** Credit prices from the `quota.cost.*` settings. */
export interface QuotaCosts {
  problem: number;
  contest: number;
  dataPer10MiB: number;
}
