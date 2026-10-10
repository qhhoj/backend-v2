import { Global, Module } from '@nestjs/common';
import { POLYGON_FETCH, PolygonClient } from './polygon-client';
import type { PolygonFetch } from './polygon-client';

/** Imported by api and worker (needs the global `SettingsModule`). */
@Global()
@Module({
  providers: [
    PolygonClient,
    {
      provide: POLYGON_FETCH,
      // Late-bound, so a test that replaces the global fetch is seen.
      useValue: ((...args) => fetch(...args)) as PolygonFetch,
    },
  ],
  exports: [PolygonClient],
})
export class PolygonApiModule {}
