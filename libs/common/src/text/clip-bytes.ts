/** Shortens to at most `maxBytes` of UTF-8 without splitting a character (the schema bounds bytes, not characters). */
export function clipBytes(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text) <= maxBytes) return text;
  const bytes = Buffer.from(text, 'utf8');
  let end = maxBytes;
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
  return bytes.subarray(0, end).toString('utf8');
}
