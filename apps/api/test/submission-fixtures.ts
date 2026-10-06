import type Redis from 'ioredis';
import { REDIS } from '@libs/common';
import { BRIDGE_COMMANDS_STREAM, parseBridgeCommand } from '@libs/judging';
import type { BridgeCommand } from '@libs/judging';
import type { ApiTest } from './setup';

/** What the api told the bridge, oldest first. */
export const bridgeCommands = async (api: ApiTest): Promise<BridgeCommand[]> =>
  (
    await api.app.get<Redis>(REDIS).xrange(BRIDGE_COMMANDS_STREAM, '-', '+')
  ).map(([, fields]) =>
    parseBridgeCommand(fields[fields.indexOf('command') + 1])!,
  );

export const clearBridgeCommands = async (api: ApiTest): Promise<void> => {
  await api.app.get<Redis>(REDIS).del(BRIDGE_COMMANDS_STREAM);
};

/** Supertest bodies are `any` (lint `no-unsafe-member-access`): read the envelope's `data` with a type. */
export const dataOf = <Data>({ body }: { body: unknown }): Data =>
  (body as { data: Data }).data;
