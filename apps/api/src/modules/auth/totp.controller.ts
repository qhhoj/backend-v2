import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import {
  AllowPartialAuth,
  AllowPwnedPassword,
  CurrentAuth,
  SessionOnly,
} from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { CodeDto } from './dto/code.dto';
import { TotpService } from './totp.service';

@Controller('api/internal/auth/2fa/totp')
export class TotpController {
  constructor(private readonly totp: TotpService) {}

  @SessionOnly()
  @Post('enroll')
  enroll(
    @CurrentAuth() auth: AuthContext,
  ): Promise<{ secret: string; otpauthUrl: string }> {
    return this.totp.enroll(auth);
  }

  @SessionOnly()
  @Post('confirm')
  confirm(
    @CurrentAuth() auth: AuthContext,
    @Body() body: CodeDto,
  ): Promise<{ scratchCodes: string[] }> {
    return this.totp.confirm(auth, body.code);
  }

  @SessionOnly()
  @AllowPartialAuth()
  @AllowPwnedPassword()
  @Post('verify')
  @HttpCode(204)
  verify(@CurrentAuth() auth: AuthContext, @Body() body: CodeDto) {
    return this.totp.verify(auth, body.code);
  }

  @SessionOnly()
  @Post('disable')
  @HttpCode(204)
  disable(@CurrentAuth() auth: AuthContext, @Body() body: CodeDto) {
    return this.totp.disable(auth, body.code);
  }

  @SessionOnly()
  @Post('scratch-codes')
  regenerateScratchCodes(
    @CurrentAuth() auth: AuthContext,
    @Body() body: CodeDto,
  ): Promise<{ scratchCodes: string[] }> {
    return this.totp.regenerateScratchCodes(auth, body.code);
  }
}
