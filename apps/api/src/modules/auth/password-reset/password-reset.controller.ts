import { ApiTags } from '@nestjs/swagger';
import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Public } from '@libs/auth';
import {
  PasswordResetConfirmDto,
  PasswordResetRequestDto,
} from './dto/password-reset.dto';
import { PasswordResetService } from './password-reset.service';

@Public()
@ApiTags('Auth')
@Controller('api/internal/auth/password/reset')
export class PasswordResetController {
  constructor(private readonly passwordReset: PasswordResetService) {}

  /**
   * Request a password reset mail
   *
   * @remarks
   * Public. Mails a reset link (valid 3 days) to every active account with the email, and also serves accounts without a usable password, for which the link sets the first one. Answers 204 whether or not the email matches. Limited per IP and per email (10 and 3 per hour, 429 `rate_limited`); 503 `mail_unavailable` when mail is not configured.
   */
  @Post()
  @HttpCode(204)
  request(
    @Body() body: PasswordResetRequestDto,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    return this.passwordReset.request(body.email, request.ip);
  }

  /**
   * Set a new password from a reset link
   *
   * @remarks
   * Public. Takes the token from the reset mail and the new password. On success the password changes, the account's API token is revoked and all its sessions are signed out. Errors: 400 `invalid_token` for an unknown, expired or already used link, 400 `validation_failed` with issues on `newPassword` (password policy or breached password). Returns 204.
   */
  @Post('confirm')
  @HttpCode(204)
  confirm(@Body() body: PasswordResetConfirmDto): Promise<void> {
    return this.passwordReset.confirm(body.token, body.newPassword);
  }
}
