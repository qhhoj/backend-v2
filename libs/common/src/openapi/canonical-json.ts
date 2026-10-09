const compareKeys = ([left]: [string, unknown], [right]: [string, unknown]) =>
  left < right ? -1 : left > right ? 1 : 0;

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(compareKeys)
      .map(([key, member]) => [key, sortKeys(member)]),
  );
}

/** JSON with object keys sorted and a final newline: the same document always gives the same bytes, so a committed copy diffs only when the contract changes. */
export const canonicalJson = (value: unknown): string =>
  `${JSON.stringify(sortKeys(value), null, 2)}\n`;
