/** First `length` code points (legacy Python `text[:length]`): never cuts a surrogate pair in half. */
export const excerpt = (text: string, length: number): string =>
  Array.from(text).slice(0, length).join('');
