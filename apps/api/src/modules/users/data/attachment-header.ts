/** `Content-Disposition` for a file named after a user: an ASCII fallback (anything outside `[A-Za-z0-9_.-]` becomes `_`) and the exact name as RFC 5987 `filename*`, so no username can make the header invalid. */
export function attachmentHeader(filename: string): string {
  const fallback = filename.replace(/[^A-Za-z0-9_.-]/g, '_');
  const encoded = encodeURIComponent(filename).replace(
    /['()*!]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
