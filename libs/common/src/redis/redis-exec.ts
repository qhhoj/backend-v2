import { ChainableCommander } from 'ioredis';

/** Runs a multi/pipeline and returns the command results; throws on an aborted transaction or the first command error. */
export const execOrThrow = async (
  pipeline: ChainableCommander,
): Promise<unknown[]> => {
  const results = await pipeline.exec();
  if (!results) throw new Error('Redis transaction was aborted');
  const failure = results.find(([error]) => error);
  if (failure?.[0]) throw failure[0];
  return results.map(([, value]) => value);
};
