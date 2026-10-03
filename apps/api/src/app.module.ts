import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import {
  EnvModule,
  MailModule,
  RedisModule,
  StorageModule,
} from '@libs/common';
import { DatabaseModule } from '@libs/database';
import { AuthApiModule } from './modules/auth/auth-api.module';
import { ApiV2Module } from './modules/api-v2/api-v2.module';
import { ProblemsApiModule } from './modules/problems/problems-api.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    EnvModule,
    DatabaseModule,
    RedisModule,
    MailModule,
    StorageModule,
    ScheduleModule.forRoot(),
    AuthApiModule,
    ProblemsApiModule,
    ApiV2Module,
  ],
  controllers: [HealthController],
})
export class AppModule {}
