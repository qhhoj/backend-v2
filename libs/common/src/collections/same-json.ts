/** Structural equality by JSON text: key order counts, so both sides must come from the same shape. */
export const sameJson = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right);
