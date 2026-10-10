import { ApiTags } from '@nestjs/swagger';
import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import {
  AllowBeforeTwoFactor,
  AllowPwnedPassword,
  CurrentAuth,
  NoImpersonation,
  SessionOnly,
} from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { CodeDto } from './dto/code.dto';
import {
  ScratchCodesRemainingResponse,
  ScratchCodesResponse,
  TotpEnrollmentResponse,
} from './dto/totp.response';
import { CurrentPasswordDto } from '../core/dto/current-password.dto';
import { TotpService } from './totp.service';

@ApiTags('Auth')
@Controller('api/internal/auth/2fa/totp')
export class TotpController {
  constructor(private readonly totp: TotpService) {}

  /**
   * Start authenticator app setup
   *
   * @remarks
   * Browser session only, not while impersonating. Requires the current password. Generates a TOTP secret, keeps it pending on the session and returns it with an `otpauth://` URL for a QR code; setup finishes with `POST /auth/2fa/totp/confirm`. Errors: 400 `invalid_credentials` (wrong password), 400 `invalid_code` when TOTP is already enabled.
   */
  @SessionOnly()
  @NoImpersonation()
  @Post('enroll')
  enroll(
    @CurrentAuth() auth: AuthContext,
    @Body() body: CurrentPasswordDto,
  ): Promise<TotpEnrollmentResponse> {
    return this.totp.enroll(auth, body.currentPassword);
  }

  /**
   * Finish authenticator app setup
   *
   * @remarks
   * Browser session only, not while impersonating. Checks a code from the app against the pending secret, enables TOTP and returns the one-time scratch (backup) codes, shown only now. Errors: 400 `invalid_code` for a wrong code or when there is no pending setup.
   */
  @SessionOnly()
  @NoImpersonation()
  @Post('confirm')
  confirm(
    @CurrentAuth() auth: AuthContext,
    @Body() body: CodeDto,
  ): Promise<ScratchCodesResponse> {
    return this.totp.confirm(auth, body.code);
  }

  /**
   * Pass the second factor with a TOTP or scratch code
   *
   * @remarks
   * Browser session. Accepts a 6-digit app code or an unused scratch code and marks the session as fully signed in. A scratch code works once and a TOTP step cannot be replayed. Does nothing when the session already passed. Attempts share a per-account budget (10 in 15 minutes and 50 a day, 429 `rate_limited`); 400 `invalid_code` for a wrong code. Returns 204.
   */
  @SessionOnly()
  @AllowBeforeTwoFactor()
  @AllowPwnedPassword()
  @Post('verify')
  @HttpCode(204)
  verify(@CurrentAuth() auth: AuthContext, @Body() body: CodeDto) {
    return this.totp.verify(auth, body.code);
  }

  /**
   * Turn off authenticator app sign-in
   *
   * @remarks
   * Browser session only, not while impersonating. Needs a valid TOTP or scratch code; removes the secret and the scratch codes. Errors: 400 `totp_not_enabled`, 400 `invalid_code`, 429 `rate_limited`. Returns 204.
   */
  @SessionOnly()
  @NoImpersonation()
  @Post('disable')
  @HttpCode(204)
  disable(@CurrentAuth() auth: AuthContext, @Body() body: CodeDto) {
    return this.totp.disable(auth, body.code);
  }

  /**
   * Replace the scratch codes
   *
   * @remarks
   * Browser session only, not while impersonating. Needs a valid TOTP or scratch code, then replaces all scratch codes with a new set, returned once. Errors: 400 `totp_not_enabled`, 400 `invalid_code`, 429 `rate_limited`.
   */
  @SessionOnly()
  @NoImpersonation()
  @Post('scratch-codes')
  regenerateScratchCodes(
    @CurrentAuth() auth: AuthContext,
    @Body() body: CodeDto,
  ): Promise<ScratchCodesResponse> {
    return this.totp.regenerateScratchCodes(auth, body.code);
  }

  /**
   * Count unused scratch codes
   *
   * @remarks
   * Browser session only, not while impersonating. Returns how many scratch codes are left; 400 `totp_not_enabled` when TOTP is off.
   */
  @SessionOnly()
  @NoImpersonation()
  @Get('scratch-codes')
  remainingScratchCodes(
    @CurrentAuth() auth: AuthContext,
  ): ScratchCodesRemainingResponse {
    return this.totp.remainingScratchCodes(auth);
  }
}
