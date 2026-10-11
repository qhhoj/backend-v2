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
