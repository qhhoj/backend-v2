import type { Json } from './matcher';

/** Placeholder name (`s1`, `session:j1`) -> bound value. */
export type Bindings = ReadonlyMap<string, string>;

const PLACEHOLDER = /^\{\{(.+)\}\}$/;

function generated(fields: Record<string, Json>): Json | undefined {
  if ('$repeat' in fields) {
    const [text, count] = fields.$repeat as [string, number];
    if (typeof text !== 'string' || !Number.isInteger(count))
      throw new Error('$repeat takes [text, count]');
    return text.repeat(count);
  }
  if ('$cases' in fields) {
    const [count, status] = fields.$cases as [number, string];
    if (!Number.isInteger(count) || typeof status !== 'string')
      throw new Error('$cases takes [count, status]');
    return Array.from({ length: count }, (_unused, index) => ({
      position: index + 1,
      status,
    }));
  }
  return undefined;
}

/** A string `{{name}}` becomes its bound value; `{"$repeat": [text, n]}` becomes `text` n times; `{"$cases": [n, status]}` becomes n cases at positions 1..n. Mirrors judge-v2 `crates/conformance/src/expand.rs`. */
export function expand(value: Json, bindings: Bindings): Json {
  if (typeof value === 'string') {
    const name = PLACEHOLDER.exec(value)?.[1];
    if (name === undefined) return value;
    const bound = bindings.get(name);
    if (bound === undefined) throw new Error(`unbound placeholder {{${name}}}`);
    return bound;
  }
  if (Array.isArray(value)) return value.map((item) => expand(item, bindings));
  if (value === null || typeof value !== 'object') return value;
  const made = generated(value);
  if (made !== undefined) return made;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, expand(item, bindings)]),
  );
}
