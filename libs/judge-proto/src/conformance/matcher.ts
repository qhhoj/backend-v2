/** Partial matching of an observed proto3-JSON message against a scenario expectation. Mirrors judge-v2 `crates/conformance/src/matcher.rs`; `proto/conformance/matcher-cases.json` pins both. */
export type Json =
  null | boolean | number | string | Json[] | { [key: string]: Json };

const isObject = (value: unknown): value is Record<string, Json> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The proto3 default a missing field stands for. */
function isDefault(value: Json): boolean {
  if (value === null || value === false || value === 0) return true;
  if (typeof value === 'string')
    return value === '' || value === '0' || value.endsWith('_UNSPECIFIED');
  if (Array.isArray(value)) return value.length === 0;
  if (isObject(value)) return Object.values(value).every(isDefault);
  return false;
}

const numberText = (value: unknown): string | null =>
  typeof value === 'number' || typeof value === 'string' ? String(value) : null;

const asBigInt = (text: string): bigint | null => {
  try {
    return /^-?\d+$/.test(text) ? BigInt(text) : null;
  } catch {
    return null;
  }
};

/** 64-bit integers print as strings in proto3 JSON and as numbers here, so `"7"` equals `7`; integers compare exactly, others as floats. */
function scalarsEqual(expected: Json, actual: unknown): boolean {
  if (expected === actual) return true;
  const left = numberText(expected);
  const right = numberText(actual);
  if (left === null || right === null) return false;
  const [leftInt, rightInt] = [asBigInt(left), asBigInt(right)];
  if (leftInt !== null && rightInt !== null) return leftInt === rightInt;
  const [leftFloat, rightFloat] = [Number(left), Number(right)];
  return (
    left.trim() !== '' &&
    right.trim() !== '' &&
    !Number.isNaN(leftFloat) &&
    leftFloat === rightFloat
  );
}

function objectMismatch(
  path: string,
  expected: Record<string, Json>,
  actual: unknown,
): string | null {
  const keys = Object.keys(expected);
  // `{}` names a oneof member or an empty message: it must be there
  if (actual === undefined || actual === null) {
    if (!keys.length) return `${path}: expected a value, got none`;
  } else if (!isObject(actual))
    return `${path}: expected an object, got ${JSON.stringify(actual)}`;
  for (const key of keys) {
    const found = mismatchAt(
      `${path}.${key}`,
      expected[key],
      isObject(actual) ? actual[key] : undefined,
    );
    if (found) return found;
  }
  return null;
}

function arrayMismatch(
  path: string,
  expected: Json[],
  actual: unknown,
): string | null {
  const observed = Array.isArray(actual) ? (actual as unknown[]) : [];
  if (actual !== undefined && actual !== null && !Array.isArray(actual))
    return `${path}: expected an array, got ${JSON.stringify(actual)}`;
  if (observed.length !== expected.length)
    return `${path}: expected ${expected.length} items, got ${observed.length}`;
  for (const [index, item] of expected.entries()) {
    const found = mismatchAt(`${path}[${index}]`, item, observed[index]);
    if (found) return found;
  }
  return null;
}

function mismatchAt(
  path: string,
  expected: Json,
  actual: unknown,
): string | null {
  if (expected === '*')
    return actual === undefined || actual === null
      ? `${path}: expected a value, got none`
      : null;
  if (isObject(expected)) return objectMismatch(path, expected, actual);
  if (Array.isArray(expected)) return arrayMismatch(path, expected, actual);
  if ((actual === undefined || actual === null) && isDefault(expected))
    return null;
  if (scalarsEqual(expected, actual)) return null;
  return `${path}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual ?? null)}`;
}

/** Null when every field `expected` names matches `actual` (a missing field holds its proto3 default, `{}` needs the field present, `"*"` matches any present value, and every top-level key must be present); otherwise what differs, with its path. */
export function mismatch(expected: Json, actual: unknown): string | null {
  return missingMember(expected, actual) ?? mismatchAt('$', expected, actual);
}

/** The top-level keys name the oneof member of a message: it must be the one sent, however empty its expectation is. */
function missingMember(expected: Json, actual: unknown): string | null {
  if (!isObject(expected)) return null;
  const observed = isObject(actual) ? actual : {};
  const missing = Object.keys(expected).find(
    (key) => observed[key] === undefined || observed[key] === null,
  );
  return missing === undefined
    ? null
    : `$.${missing}: expected this message, got ${JSON.stringify(actual ?? null)}`;
}
