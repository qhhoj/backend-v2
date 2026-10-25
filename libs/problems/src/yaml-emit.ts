/**
 * Emits the fixed `init.yml` shape for judge-v2 (serde_norway, YAML 1.2), still readable by PyYAML (YAML 1.1):
 * block style, sorted keys. Every string value is double-quoted, so no reader retypes a name (`1e5`, `0o17`, `yes`)
 * as a number or bool; mapping keys stay plain when they are identifiers that no resolver retypes.
 */
const PLAIN_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RESERVED_WORD = /^(yes|no|true|false|on|off|null)$/i;
// YAML readers refuse these raw: DEL, C1 controls, line/paragraph separators, BOM, noncharacters.
const isUnreadable = (code: number) =>
  (code >= 0x7f && code <= 0x9f) ||
  [0x2028, 0x2029, 0xfeff, 0xfffe, 0xffff].includes(code);

const quote = (text: string) =>
  [...JSON.stringify(text)]
    .map((char) =>
      isUnreadable(char.charCodeAt(0))
        ? `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`
        : char,
    )
    .join('');

const emitKey = (key: string) =>
  PLAIN_KEY.test(key) && !RESERVED_WORD.test(key) ? key : quote(key);

/** Integers as-is, floats like PyYAML `repr` (`1.0e+21`: the 1.1 float resolver needs a dot). */
function emitNumber(value: number): string {
  const text = Number.isSafeInteger(value)
    ? String(value)
    : String(Number.isInteger(value) ? value.toExponential() : value);
  return /^-?\d+$/.test(text) || text.includes('.')
    ? text
    : text.replace('e', '.0e');
}

function emitScalar(value: unknown): string {
  if (typeof value === 'string') return quote(value);
  if (typeof value === 'number') return emitNumber(value);
  return typeof value === 'boolean' ? String(value) : 'null';
}

const isCollection = (value: unknown): value is object =>
  typeof value === 'object' && value !== null;
const isEmpty = (value: object) =>
  Array.isArray(value) ? !value.length : !Object.keys(value).length;

/** Lines of a collection at column 0; callers indent them. Recursion depth is bounded by the caller's argument checks. */
function collectionLines(value: object): string[] {
  const entries: [string, unknown][] = Array.isArray(value)
    ? value.map((item) => ['-', item])
    : Object.entries(value)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, item]) => [`${emitKey(key)}:`, item]);
  return entries.flatMap(([label, item]) => {
    if (!isCollection(item)) return [`${label} ${emitScalar(item)}`];
    if (isEmpty(item)) return [`${label} ${Array.isArray(item) ? '[]' : '{}'}`];
    const nested = collectionLines(item);
    // A sequence item shares its line with the first nested entry (`- a: 1`), a mapping value starts below its key.
    return label === '-'
      ? [`- ${nested[0]}`, ...nested.slice(1).map((line) => `  ${line}`)]
      : [label, ...nested.map((line) => `  ${line}`)];
  });
}

export const emitYaml = (document: Record<string, unknown>): string =>
  `${collectionLines(document).join('\n')}\n`;
