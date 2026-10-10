import { createHash, randomInt } from 'node:crypto';

export interface PolygonCredentials {
  apiKey: string;
  apiSecret: string;
}

/** The parts of a signature a test pins: the 6-character salt and the Unix time in seconds. */
export interface SignatureSalt {
  rand: string;
  time: number;
}

export const randomSalt = (): SignatureSalt => ({
  rand: String(randomInt(0, 1_000_000)).padStart(6, '0'),
  time: Math.floor(Date.now() / 1000),
});

/**
 * Polygon's request signature: `params` plus `apiKey`, `time` and `apiSig`, where `apiSig` is the salt followed by
 * the SHA-512 hex of `<rand>/<method>?<k1>=<v1>&...#<secret>` over every parameter (apiKey and time included), sorted
 * by name and then by value. Values are hashed raw, not percent-encoded: Polygon decodes before it verifies.
 */
export function signPolygonParams(
  method: string,
  params: Record<string, string>,
  credentials: PolygonCredentials,
  salt: SignatureSalt,
): Record<string, string> {
  const signed: Record<string, string> = {
    ...params,
    apiKey: credentials.apiKey,
    time: String(salt.time),
  };
  const query = Object.entries(signed)
    .sort(([keyA, valueA], [keyB, valueB]) =>
      keyA === keyB ? compare(valueA, valueB) : compare(keyA, keyB),
    )
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
  const digest = createHash('sha512')
    .update(`${salt.rand}/${method}?${query}#${credentials.apiSecret}`)
    .digest('hex');
  return { ...signed, apiSig: salt.rand + digest };
}

/** Code-unit order, like Python's `sorted` that Polygon's reference clients use; `localeCompare` would differ on case. */
const compare = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;
