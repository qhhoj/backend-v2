/** Rows ranked above `value` on a descending `field`; null sorts last, so every non-null value is above it. */
export const strictlyAbove = (
  field: string,
  value: number | null,
): Record<string, unknown> =>
  value === null ? { [field]: { $ne: null } } : { [field]: { $gt: value } };
