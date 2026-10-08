import { Global, Logger, Module } from '@nestjs/common';
import { ENV, loadEnv } from './env';
import { removedEnvInUse } from './removed-env';

@Global()
@Module({
  providers: [
    {
      provide: ENV,
      useFactory: () => {
        const env = loadEnv();
        const stale = removedEnvInUse();
        if (stale.length)
          new Logger('Env').warn(
            `Ignoring ${stale.join(', ')}: these are admin settings now (/api/internal/admin/settings)`,
          );
        return env;
      },
    },
  ],
  exports: [ENV],
})
export class EnvModule {}
