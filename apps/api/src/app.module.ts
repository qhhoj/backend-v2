import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from '@libs/auth';
import { EnvModule, RedisModule } from '@libs/common';
import { DatabaseModule } from '@libs/database';
import { HealthController } from './health.controller';

@Module({
  imports: [
    EnvModule,
    DatabaseModule,
    RedisModule,
    ScheduleModule.forRoot(),
    AuthModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
