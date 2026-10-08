const TIMEOUT_MS = 5000;

/** Provider request with a timeout; throws on a non-2xx status or a non-JSON body. */
export async function fetchJson<Body>(
  label: string,
  url: string,
  init: RequestInit = {},
): Promise<Body> {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`${label} failed: HTTP ${response.status}`);
  return (await response.json()) as Body;
}

/** A provider-issued string, or a non-empty string/number id, else throws. */
export function requireText(label: string, value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string' && value !== '') return value;
  throw new Error(`${label} is missing`);
}
