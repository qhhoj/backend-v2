import { NEAR_LIMIT_PERCENT } from './quota.constants';
import type { QuotaMeter } from './quota.types';

/** A limit of 0 admits no positive charge (enforce refuses it, warn logs it as over), so the meter is full and over whatever is used. */
const limited = (used: number, limit: number): QuotaMeter => ({
  used,
  limit,
  isNearLimit: limit > 0 ? used * 100 >= limit * NEAR_LIMIT_PERCENT : true,
  isOver: limit > 0 ? used > limit : true,
});

/** An unlimited organization keeps its reported limit but is never near or over it. */
export const meterOf = (
  used: number,
  limit: number,
  unlimited = false,
): QuotaMeter =>
  unlimited
    ? { used, limit, isNearLimit: false, isOver: false }
    : limited(used, limit);
