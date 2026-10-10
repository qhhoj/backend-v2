import { escapeRegExp } from '@libs/common';

const VARIANTS: Record<string, string> = {
  a: 'aàáạảãâầấậẩẫăằắặẳẵ',
  d: 'dđ',
  e: 'eèéẹẻẽêềếệểễ',
  i: 'iìíịỉĩ',
  o: 'oòóọỏõôồốộổỗơờớợởỡ',
  u: 'uùúụủũưừứựửữ',
  y: 'yỳýỵỷỹ',
};

/** Both cases are listed: PCRE's `i` flag is not reliable for non-ASCII letters. */
const CLASSES = new Map(
  Object.entries(VARIANTS).map(([base, variants]) => [
    base,
    `[${variants}${variants.toUpperCase()}]`,
  ]),
);

const foldToBase = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();

/** Pattern matching `word` as a literal, ignoring case and Vietnamese diacritics (`xep` matches `Xếp`, `d` matches `đ`). */
export function diacriticInsensitivePattern(word: string): string {
  return [...foldToBase(word)]
    .map((char) => CLASSES.get(char) ?? escapeRegExp(char))
    .join('');
}
