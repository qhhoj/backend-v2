import { Module } from '@nestjs/common';
import type { DynamicModule, Provider } from '@nestjs/common';
import { ENV } from './env';
import type { ProcessConfig } from './env';

/** Provides `ENV` everywhere: the process's root module loads its config here, a spec passes the values it needs. */
@Module({})
export class EnvModule {
  static forRoot(config: ProcessConfig<object>): DynamicModule {
    return EnvModule.withProvider({
      provide: ENV,
      useFactory: () => config.load(),
    });
  }

  static forValues(values: object): DynamicModule {
    return EnvModule.withProvider({ provide: ENV, useValue: values });
  }

  private static withProvider(provider: Provider): DynamicModule {
    return {
      module: EnvModule,
      global: true,
      providers: [provider],
      exports: [ENV],
    };
  }
}
