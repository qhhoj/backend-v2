const compareKeys = ([left]: [string, unknown], [right]: [string, unknown]) =>
  left < right ? -1 : left > right ? 1 : 0;

const typeRank = (value: unknown): number =>
  typeof value === 'number' ? 0 : typeof value === 'string' ? 1 : 2;

/** Numbers numerically, then strings by code point, then anything else (null, booleans) in the given order. */
export function compareEnumValues(left: unknown, right: unknown): number {
  const ranks = typeRank(left) - typeRank(right);
  if (ranks !== 0) return ranks;
  if (typeof left === 'number' && typeof right === 'number')
    return left - right;
  if (typeof left === 'string' && typeof right === 'string')
    return left < right ? -1 : left > right ? 1 : 0;
  return 0;
}

/** An `enum` list is a set: the swagger plugin orders one derived from a union by compiler type ids, which vary with load order. */
const sortedEnum = (members: unknown[]): unknown[] =>
  [...members].sort(compareEnumValues);

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(compareKeys)
      .map(([key, member]) => [
        key,
        sortKeys(
          key === 'enum' && Array.isArray(member) ? sortedEnum(member) : member,
        ),
      ]),
  );
}

/** JSON with object keys and `enum` lists sorted and a final newline: the same document always gives the same bytes, so a committed copy diffs only when the contract changes. */
export const canonicalJson = (value: unknown): string =>
  `${JSON.stringify(sortKeys(value), null, 2)}\n`;
