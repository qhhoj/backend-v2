import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { EnvModule, RedisModule } from '@libs/common';
import { DatabaseModule } from '@libs/database';
import { AuthApiModule } from './modules/auth/auth.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    EnvModule,
    DatabaseModule,
    RedisModule,
    ScheduleModule.forRoot(),
    AuthApiModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
