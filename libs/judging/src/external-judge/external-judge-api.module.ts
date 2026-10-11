import { Global, Module } from '@nestjs/common';
import {
  EXTERNAL_JUDGE_FETCH,
  ExternalJudgeClient,
} from './external-judge-client';
import type { ExternalJudgeFetch } from './external-judge-client';

/** Imported by the api and the bridge (needs the global `SettingsModule`). */
@Global()
@Module({
  providers: [
    ExternalJudgeClient,
    {
      provide: EXTERNAL_JUDGE_FETCH,
      // Late-bound, so a test that replaces the global fetch is seen.
      useValue: ((...args) => fetch(...args)) as ExternalJudgeFetch,
    },
  ],
  exports: [ExternalJudgeClient],
})
export class ExternalJudgeApiModule {}
