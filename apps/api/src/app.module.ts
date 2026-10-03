import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { EnvModule, MailModule, RedisModule } from '@libs/common';
import { DatabaseModule } from '@libs/database';
import { AuthApiModule } from './modules/auth/auth-api.module';
import { ProblemsApiModule } from './modules/problems/problems-api.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    EnvModule,
    DatabaseModule,
    RedisModule,
    MailModule,
    ScheduleModule.forRoot(),
    AuthApiModule,
    ProblemsApiModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
