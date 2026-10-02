import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SCHEMAS } from './schemas';

const models = MongooseModule.forFeature(SCHEMAS);

@Global()
@Module({
  imports: [
    MongooseModule.forRootAsync({
      useFactory: () => ({ uri: process.env.MONGO_URL }),
    }),
    models,
  ],
  exports: [models],
})
export class DatabaseModule {}
