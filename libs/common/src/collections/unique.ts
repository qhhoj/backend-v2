/** The values without repeats, in first-seen order. */
export const unique = <Value>(values: Value[]): Value[] => [...new Set(values)];
