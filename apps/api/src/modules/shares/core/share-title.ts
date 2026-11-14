/** Titles are plain text on one line: control characters (newlines, tabs) become spaces, runs of spaces one. */
export const cleanTitle = (title: string | undefined): string =>
  (title ?? '').replace(/[\p{Cc}\s]+/gu, ' ').trim();
