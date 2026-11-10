import { Module } from '@nestjs/common';
import type { DynamicModule, Provider } from '@nestjs/common';
import { ENV, TUNING } from './env';
import type { ProcessConfig } from './env';

/** Provides `ENV` and `TUNING` everywhere: the process's root module declares both here, a spec passes the values it needs. */
@Module({})
export class EnvModule {
  static forRoot(config: ProcessConfig<object>, tuning: object): DynamicModule {
    return EnvModule.withProviders(
      { provide: ENV, useFactory: () => config.load() },
      tuning,
    );
  }

  static forValues(values: object, tuning: object = {}): DynamicModule {
    return EnvModule.withProviders({ provide: ENV, useValue: values }, tuning);
  }

  private static withProviders(env: Provider, tuning: object): DynamicModule {
    return {
      module: EnvModule,
      global: true,
      providers: [env, { provide: TUNING, useValue: tuning }],
      exports: [ENV, TUNING],
    };
  }
}
