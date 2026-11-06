/** Any C0 control (U+0000 to U+001F) or DEL: it cannot sit in a header, a log line, a file name or a CSV field. */
// eslint-disable-next-line no-control-regex
export const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

export const hasControlCharacter = (text: string): boolean =>
  CONTROL_CHARACTER.test(text);
