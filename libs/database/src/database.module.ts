import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SCHEMAS } from './schemas';

const models = MongooseModule.forFeature(SCHEMAS);

@Module({})
export class DatabaseModule {
  /** The connection and every model, for the whole process. `config` is the token of the process config (`ENV` of `@libs/common`, which imports this lib), whose `mongoUrl` the connection opens. */
  static forRoot(config: symbol): DynamicModule {
    return {
      module: DatabaseModule,
      global: true,
      imports: [
        MongooseModule.forRootAsync({
          inject: [config],
          useFactory: ({ mongoUrl }: { mongoUrl: string }) => ({
            uri: mongoUrl,
          }),
        }),
        models,
      ],
      exports: [models],
    };
  }
}
