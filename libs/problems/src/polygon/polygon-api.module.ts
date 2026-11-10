import { Global, Module } from '@nestjs/common';
import { PolygonClient } from './polygon-client';

/** Imported by api and worker (needs the global `SettingsModule`). */
@Global()
@Module({
  providers: [PolygonClient],
  exports: [PolygonClient],
})
export class PolygonApiModule {}
