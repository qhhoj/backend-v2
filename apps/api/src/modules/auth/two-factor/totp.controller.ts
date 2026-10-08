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

@Controller('api/internal/auth/2fa/totp')
export class TotpController {
  constructor(private readonly totp: TotpService) {}

  @SessionOnly()
  @NoImpersonation()
  @Post('enroll')
  enroll(
    @CurrentAuth() auth: AuthContext,
    @Body() body: CurrentPasswordDto,
  ): Promise<TotpEnrollmentResponse> {
    return this.totp.enroll(auth, body.currentPassword);
  }

  @SessionOnly()
  @NoImpersonation()
  @Post('confirm')
  confirm(
    @CurrentAuth() auth: AuthContext,
    @Body() body: CodeDto,
  ): Promise<ScratchCodesResponse> {
    return this.totp.confirm(auth, body.code);
  }

  @SessionOnly()
  @AllowBeforeTwoFactor()
  @AllowPwnedPassword()
  @Post('verify')
  @HttpCode(204)
  verify(@CurrentAuth() auth: AuthContext, @Body() body: CodeDto) {
    return this.totp.verify(auth, body.code);
  }

  @SessionOnly()
  @NoImpersonation()
  @Post('disable')
  @HttpCode(204)
  disable(@CurrentAuth() auth: AuthContext, @Body() body: CodeDto) {
    return this.totp.disable(auth, body.code);
  }

  @SessionOnly()
  @NoImpersonation()
  @Post('scratch-codes')
  regenerateScratchCodes(
    @CurrentAuth() auth: AuthContext,
    @Body() body: CodeDto,
  ): Promise<ScratchCodesResponse> {
    return this.totp.regenerateScratchCodes(auth, body.code);
  }

  @SessionOnly()
  @NoImpersonation()
  @Get('scratch-codes')
  remainingScratchCodes(
    @CurrentAuth() auth: AuthContext,
  ): ScratchCodesRemainingResponse {
    return this.totp.remainingScratchCodes(auth);
  }
}
