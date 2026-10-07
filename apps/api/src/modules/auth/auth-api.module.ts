import { Module } from '@nestjs/common';
import { AuthModule } from '@libs/auth';
import { ENV, RateLimitService } from '@libs/common';
import type { Env } from '@libs/common';
import { AuthController } from './core/auth.controller';
import { AuthService } from './core/auth.service';
import { ImpersonationController } from './impersonation/impersonation.controller';
import { ImpersonationService } from './impersonation/impersonation.service';
import { PasswordResetController } from './password-reset/password-reset.controller';
import { PasswordResetService } from './password-reset/password-reset.service';
import { RegistrationController } from './registration/registration.controller';
import { RegistrationService } from './registration/registration.service';
import { SecondFactorService } from './two-factor/second-factor.service';
import { FacebookOAuthProvider } from './social/facebook.oauth-provider';
import { GithubOAuthProvider } from './social/github.oauth-provider';
import { GoogleOAuthProvider } from './social/google.oauth-provider';
import { OAUTH_PROVIDERS } from './social/oauth-provider';
import type { OAuthProvider } from './social/oauth-provider';
import { SocialController } from './social/social.controller';
import { SocialService } from './social/social.service';
import { TotpController } from './two-factor/totp.controller';
import { TotpService } from './two-factor/totp.service';
import { WebauthnController } from './two-factor/webauthn.controller';
import { WebauthnService } from './two-factor/webauthn.service';

@Module({
  imports: [AuthModule],
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
    ImpersonationService,
    RegistrationService,
    PasswordResetService,
    SecondFactorService,
    TotpService,
    WebauthnService,
    RateLimitService,
    SocialService,
    {
      provide: OAUTH_PROVIDERS,
      inject: [ENV],
      useFactory: ({ oauth }: Env): OAuthProvider[] => {
        const configured: Array<OAuthProvider | null> = [
          oauth.google && new GoogleOAuthProvider(oauth.google),
          oauth.facebook && new FacebookOAuthProvider(oauth.facebook),
          oauth.github && new GithubOAuthProvider(oauth.github),
        ];
        return configured.filter((provider) => provider !== null);
      },
    },
  ],
})
export class AuthApiModule {}
