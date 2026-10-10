import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common';
import {
  AllowBeforeTwoFactor,
  AllowPwnedPassword,
  CurrentAuth,
  NoImpersonation,
  SessionOnly,
} from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { ApiCreatedResponse, ApiParam, ApiTags } from '@nestjs/swagger';
import { OPAQUE_JSON_OBJECT } from '@libs/common';
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/server';
import { CurrentPasswordDto } from '../core/dto/current-password.dto';
import { WebauthnCredentialResponse } from './dto/webauthn.response';
import { WebauthnLoginDto, WebauthnRegisterDto } from './dto/webauthn.dto';
import { WebauthnService } from './webauthn.service';

@ApiTags('Auth')
@Controller('api/internal/auth/2fa/webauthn')
export class WebauthnController {
  constructor(private readonly webauthn: WebauthnService) {}

  /**
   * List registered security keys
   *
   * @remarks
   * Browser session only, not while impersonating. Returns the user's WebAuthn security keys, oldest first. Only the display name and id are returned.
   */
  @SessionOnly()
  @NoImpersonation()
  @Get('credentials')
  list(@CurrentAuth() auth: AuthContext): WebauthnCredentialResponse[] {
    return this.webauthn.list(auth);
  }

  /**
   * Get options to register a security key
   *
   * @remarks
   * Browser session only, not while impersonating. Requires the current password (400 `invalid_credentials`, 429 `rate_limited`). Returns WebAuthn credential creation options for `navigator.credentials.create`; the challenge is stored on the session and used by the next `register/verify` call.
   */
  @SessionOnly()
  @NoImpersonation()
  @ApiCreatedResponse({ schema: OPAQUE_JSON_OBJECT })
  @Post('register/options')
  registrationOptions(
    @CurrentAuth() auth: AuthContext,
    @Body() body: CurrentPasswordDto,
  ): Promise<PublicKeyCredentialCreationOptionsJSON> {
    return this.webauthn.registrationOptions(auth, body.currentPassword);
  }

  /**
   * Register a security key
   *
   * @remarks
   * Browser session only, not while impersonating. Verifies the browser's registration response against the pending challenge, stores the key under the given name and returns it. Errors: 400 `webauthn_failed` (no pending challenge, failed verification, or the authenticator is already registered).
   */
  @SessionOnly()
  @NoImpersonation()
  @Post('register/verify')
  register(
    @CurrentAuth() auth: AuthContext,
    @Body() body: WebauthnRegisterDto,
  ): Promise<WebauthnCredentialResponse> {
    return this.webauthn.register(auth, body.name, body.response);
  }

  /**
   * Get options to sign in with a security key
   *
   * @remarks
   * Browser session, usable before the second factor is passed. Returns WebAuthn request options for `navigator.credentials.get` and stores the challenge on the session. Returns null (nothing stored) when the session already passed its second factor. Errors: 400 `webauthn_not_enabled` when the user has no key.
   */
  @SessionOnly()
  @AllowBeforeTwoFactor()
  @AllowPwnedPassword()
  @ApiCreatedResponse({ schema: { ...OPAQUE_JSON_OBJECT, nullable: true } })
  @Post('login/options')
  loginOptions(
    @CurrentAuth() auth: AuthContext,
  ): Promise<PublicKeyCredentialRequestOptionsJSON | null> {
    return this.webauthn.loginOptions(auth);
  }

  /**
   * Pass the second factor with a security key
   *
   * @remarks
   * Browser session, usable before the second factor is passed. Verifies the assertion against the pending challenge and the key's sign counter, then marks the session as fully signed in. Does nothing when already passed. Shares the per-account attempt budget (429 `rate_limited`); 400 `webauthn_failed` for a missing challenge, unknown credential or failed verification. Returns 204.
   */
  @SessionOnly()
  @AllowBeforeTwoFactor()
  @AllowPwnedPassword()
  @Post('login/verify')
  @HttpCode(204)
  login(@CurrentAuth() auth: AuthContext, @Body() body: WebauthnLoginDto) {
    return this.webauthn.login(auth, body.response);
  }

  /**
   * Remove a security key
   *
   * @remarks
   * Browser session only, not while impersonating. Requires the current password in the body (400 `invalid_credentials`, 429 `rate_limited`). Errors: 404 `not_found` for an unknown key. Returns 204.
   */
  @ApiParam({
    name: 'credentialId',
    description: 'Id of the security key from the list.',
  })
  @SessionOnly()
  @NoImpersonation()
  @Delete('credentials/:credentialId')
  @HttpCode(204)
  remove(
    @CurrentAuth() auth: AuthContext,
    @Param('credentialId') credentialId: string,
    @Body() body: CurrentPasswordDto,
  ) {
    return this.webauthn.remove(auth, credentialId, body.currentPassword);
  }
}
