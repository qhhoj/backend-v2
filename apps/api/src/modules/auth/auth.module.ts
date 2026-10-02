import { Module } from '@nestjs/common';
import { AuthModule } from '@libs/auth';
import { RateLimitService } from '@libs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  imports: [AuthModule],
  controllers: [AuthController],
  providers: [AuthService, RateLimitService],
})
export class AuthApiModule {}
