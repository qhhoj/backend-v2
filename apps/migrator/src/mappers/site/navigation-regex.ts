const compiles = (source: string): boolean => {
  try {
    new RegExp(source);
    return true;
  } catch {
    return false;
  }
};

const VERBOSE = /^\(\?x\)/;

/** Python named groups as JavaScript; a leading `(?x)` (re.VERBOSE) also drops whitespace and `#` comments. */
const fromPython = (source: string): string => {
  const named = source.replace(/\(\?P</g, '(?<');
  return VERBOSE.test(named)
    ? named
        .replace(VERBOSE, '')
        .replace(/#[^\n]*/g, '')
        .replace(/\s+/g, '')
    : named;
};

/** A navigation regex the SPA can compile; null when even the converted pattern does not compile. */
export function jsRegex(
  source: string,
): { regex: string; converted: boolean } | null {
  if (compiles(source)) return { regex: source, converted: false };
  const converted = fromPython(source);
  return compiles(converted) ? { regex: converted, converted: true } : null;
}
