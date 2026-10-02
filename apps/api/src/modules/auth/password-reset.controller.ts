import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Public } from '@libs/auth';
import {
  PasswordResetConfirmDto,
  PasswordResetRequestDto,
} from './dto/password-reset.dto';
import { PasswordResetService } from './password-reset.service';

@Public()
@Controller('api/internal/auth/password/reset')
export class PasswordResetController {
  constructor(private readonly passwordReset: PasswordResetService) {}

  @Post()
  @HttpCode(204)
  request(
    @Body() body: PasswordResetRequestDto,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    return this.passwordReset.request(body.email, request.ip);
  }

  @Post('confirm')
  @HttpCode(204)
  confirm(@Body() body: PasswordResetConfirmDto): Promise<void> {
    return this.passwordReset.confirm(body.token, body.newPassword);
  }
}
