import { Module } from '@nestjs/common';
import { AuthModule } from '@libs/auth';
import { ENV, RateLimitService } from '@libs/common';
import type { Env } from '@libs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordResetController } from './password-reset.controller';
import { PasswordResetService } from './password-reset.service';
import { RegistrationController } from './registration.controller';
import { RegistrationService } from './registration.service';
import { SecondFactorService } from './second-factor.service';
import { FacebookOAuthProvider } from './social/facebook.oauth-provider';
import { GithubOAuthProvider } from './social/github.oauth-provider';
import { GoogleOAuthProvider } from './social/google.oauth-provider';
import { OAUTH_PROVIDERS } from './social/oauth-provider';
import type { OAuthProvider } from './social/oauth-provider';
import { SocialController } from './social.controller';
import { SocialService } from './social.service';
import { TotpController } from './totp.controller';
import { TotpService } from './totp.service';
import { WebauthnController } from './webauthn.controller';
import { WebauthnService } from './webauthn.service';

@Module({
  imports: [AuthModule],
  controllers: [
    AuthController,
    RegistrationController,
    PasswordResetController,
    TotpController,
    WebauthnController,
    SocialController,
  ],
  providers: [
    AuthService,
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
