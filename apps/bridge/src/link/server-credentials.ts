import { ServerCredentials } from '@grpc/grpc-js';
import { readFile } from 'node:fs/promises';
import type { Env } from '@libs/common';

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

/** TLS with the bridge's certificate, or plaintext on loopback only (dev, e2e): judge keys never cross a network in clear. */
export async function serverCredentials(
  env: Pick<
    Env,
    'judgeBridgeHost' | 'judgeBridgeTlsCert' | 'judgeBridgeTlsKey'
  >,
): Promise<ServerCredentials> {
  if (env.judgeBridgeTlsCert && env.judgeBridgeTlsKey) {
    const [certChain, privateKey] = await Promise.all([
      readFile(env.judgeBridgeTlsCert),
      readFile(env.judgeBridgeTlsKey),
    ]);
    return ServerCredentials.createSsl(
      null,
      [{ cert_chain: certChain, private_key: privateKey }],
      false,
    );
  }
  if (!LOOPBACK.has(env.judgeBridgeHost))
    throw new Error(
      `JUDGE_BRIDGE_HOST ${env.judgeBridgeHost} is not loopback: set JUDGE_BRIDGE_TLS_CERT and JUDGE_BRIDGE_TLS_KEY`,
    );
  return ServerCredentials.createInsecure();
}
