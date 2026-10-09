/** The migrator never loads `Env` (decisions.md); a job reads what it needs here and fails fast at `prepare`. */
export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

/** Where nginx serves MEDIA_ROOT, without a trailing slash; the api's default. */
export const mediaUrl = (): string =>
  (process.env.MEDIA_URL?.trim() || '/media').replace(/\/+$/, '');
