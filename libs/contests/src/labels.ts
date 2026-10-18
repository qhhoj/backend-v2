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

const LABEL_SHAPES: Record<LabelStyle, RegExp> = {
  numeric: /^[1-9]\d{0,2}$/,
  alpha: /^[A-Z]{1,3}$/,
};

/** Whether `text` has the shape of a label in `style`, without saying whether the contest has that many problems. */
export const isLabelShaped = (text: string, style: LabelStyle): boolean =>
  LABEL_SHAPES[style].test(text);
