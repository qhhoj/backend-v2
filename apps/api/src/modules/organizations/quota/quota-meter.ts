import { NEAR_LIMIT_PERCENT } from './quota.constants';
import type { QuotaMeter } from './quota.types';

export const meterOf = (used: number, limit: number): QuotaMeter => ({
  used,
  limit,
  isNearLimit: limit > 0 ? used * 100 >= limit * NEAR_LIMIT_PERCENT : used > 0,
  isOver: used > limit,
});
