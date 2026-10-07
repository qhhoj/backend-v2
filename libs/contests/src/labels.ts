import type { LabelStyle } from '@libs/database';

const LETTERS = 26;

/** Legacy default `str(index + 1)`, or ICPC's spreadsheet letters (A..Z, AA..). */
export function problemLabel(index: number, style: LabelStyle): string {
  if (style === 'numeric') return String(index + 1);
  let label = '';
  for (let remaining = index + 1; remaining > 0;) {
    label = String.fromCharCode(65 + ((remaining - 1) % LETTERS)) + label;
    remaining = Math.floor((remaining - 1) / LETTERS);
  }
  return label;
}
