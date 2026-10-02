import { Module } from '@nestjs/common';
import { AuthModule } from '@libs/auth';
import { RateLimitService } from '@libs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordResetController } from './password-reset.controller';
import { PasswordResetService } from './password-reset.service';
import { RegistrationController } from './registration.controller';
import { RegistrationService } from './registration.service';
import { SecondFactorService } from './second-factor.service';
import { TotpController } from './totp.controller';
import { TotpService } from './totp.service';

@Module({
  imports: [AuthModule],
  controllers: [
    AuthController,
    RegistrationController,
    PasswordResetController,
    TotpController,
  ],
  providers: [
    AuthService,
    RegistrationService,
    PasswordResetService,
    SecondFactorService,
    TotpService,
    RateLimitService,
  ],
})
export class AuthApiModule {}
