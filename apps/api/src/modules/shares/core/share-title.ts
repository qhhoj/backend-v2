/** Titles are plain text on one line: control characters (newlines included) are dropped. */
export const cleanTitle = (title: string | undefined): string =>
  (title ?? '').replace(/\p{Cc}/gu, '').trim();
