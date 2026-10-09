import type { Metadata } from '@grpc/grpc-js';
import type { JudgesRepository } from '../judges/judges.repository';
import type { JudgeIdentity } from './judge-session';

const MAX_KEY_LENGTH = 256;

const textOf = (metadata: Metadata, key: string): string | null => {
  const [value] = metadata.get(key);
  return typeof value === 'string' ? value : null;
};

/** The address part of `address:port`. */
export const addressOf = (peer: string): string =>
  peer.slice(0, peer.lastIndexOf(':'));

/** Metadata `x-judge-name` and `x-judge-key`, checked before any message is read: `JudgesRepository.authenticate` (sha256 compared in constant time, a dummy hash for unknown names, blocked refused). Null: refuse the call. */
export async function authenticateCall(
  metadata: Metadata,
  judges: Pick<JudgesRepository, 'authenticate'>,
  address: string | null,
): Promise<JudgeIdentity | null> {
  const name = textOf(metadata, 'x-judge-name');
  const key = textOf(metadata, 'x-judge-key');
  if (!name || !key || key.length > MAX_KEY_LENGTH) return null;
  const judge = await judges.authenticate(name, key);
  return judge && { name, ...judge, address };
}
