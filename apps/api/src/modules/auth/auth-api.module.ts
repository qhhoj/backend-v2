import { OrganizationCreationModule } from '../organizations/creation/organization-creation.module';
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
import { SocialLinksController } from './social/social-links.controller';
import { SocialLinksService } from './social/social-links.service';
import { SocialService } from './social/social.service';
import { TotpController } from './two-factor/totp.controller';
import { TotpService } from './two-factor/totp.service';
import { WebauthnController } from './two-factor/webauthn.controller';
import { WebauthnService } from './two-factor/webauthn.service';

@Module({
  imports: [AuthModule, OrganizationsApiModule, OrganizationCreationModule],
  controllers: [
    AuthController,
    ImpersonationController,
    RegistrationController,
    PasswordResetController,
    TotpController,
    WebauthnController,
    SocialController,
    SocialLinksController,
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
    SocialLinksService,
    OAuthProvidersService,
  ],
  exports: [AuthService, PasswordResetService],
})
export class AuthApiModule {}
