import {
  dataRoots,
  encryption,
  judgeLink,
  listen,
  logging,
  media,
  mongo,
  pdfRender,
  redis,
  site,
  web,
} from './config-parts';
import { processConfig } from './env';
import type { ConfigOf } from './env';

/** The env each process reads (`deploy/env.production.example` lists them all; `process-configs.spec.ts` checks the examples against these). */
export const apiConfig = processConfig(
  logging,
  mongo,
  redis,
  encryption,
  site,
  web,
  listen,
  dataRoots,
);
export type ApiConfig = ConfigOf<typeof apiConfig>;

export const workerConfig = processConfig(
  logging,
  mongo,
  redis,
  encryption,
  site,
  dataRoots,
  pdfRender,
);
export type WorkerConfig = ConfigOf<typeof workerConfig>;

/** `worker indexes`: the deploy gives it MONGO_URL alone (`deploy/qhhoj-deploy`, `build_indexes`). */
export const indexesConfig = processConfig(mongo);

/** Submission files under MEDIA_ROOT and the sealed settings; no data roots (judges read problem data themselves). */
export const bridgeConfig = processConfig(
  logging,
  mongo,
  redis,
  encryption,
  media,
  judgeLink,
);
export type BridgeConfig = ConfigOf<typeof bridgeConfig>;
