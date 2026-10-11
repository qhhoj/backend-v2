import { Module } from '@nestjs/common';
import { AuthModule } from '@libs/auth';
import { RateLimitService } from '@libs/common';
import { OrganizationsApiModule } from '../organizations/organizations-api.module';
import { ActivationService } from './registration/activation.service';
import { AuthController } from './core/auth.controller';
import { AuthService } from './core/auth.service';
import { SessionResponses } from './core/session-responses.service';
import { ImpersonationController } from './impersonation/impersonation.controller';
import { ImpersonationService } from './impersonation/impersonation.service';
import { PasswordResetController } from './password-reset/password-reset.controller';
import { PasswordResetService } from './password-reset/password-reset.service';
import { RegistrationController } from './registration/registration.controller';
import { RegistrationService } from './registration/registration.service';
import { SecondFactorService } from './two-factor/second-factor.service';
import { OAuthProvidersService } from './social/oauth-providers.service';
import { SocialController } from './social/social.controller';
import { SocialService } from './social/social.service';
import { TotpController } from './two-factor/totp.controller';
import { TotpService } from './two-factor/totp.service';
import { WebauthnController } from './two-factor/webauthn.controller';
import { WebauthnService } from './two-factor/webauthn.service';

@Module({
  imports: [AuthModule, OrganizationsApiModule],
  controllers: [
    AuthController,
    ImpersonationController,
    RegistrationController,
    PasswordResetController,
    TotpController,
    WebauthnController,
    SocialController,
  ],
  providers: [
    AuthService,
    SessionResponses,
    ImpersonationService,
    RegistrationService,
    ActivationService,
    PasswordResetService,
    SecondFactorService,
    TotpService,
    WebauthnService,
    RateLimitService,
    SocialService,
    OAuthProvidersService,
  ],
})
export class AuthApiModule {}
