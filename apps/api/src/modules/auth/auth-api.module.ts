import { Module } from '@nestjs/common';
import { AuthModule } from '@libs/auth';
import { RateLimitService } from '@libs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { RegistrationController } from './registration.controller';
import { RegistrationService } from './registration.service';

@Module({
  imports: [AuthModule],
  controllers: [AuthController, RegistrationController],
  providers: [AuthService, RegistrationService, RateLimitService],
})
export class AuthApiModule {}
