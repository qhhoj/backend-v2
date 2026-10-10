import { ApiTags } from '@nestjs/swagger';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Public } from '@libs/auth';
import { RegisterDto } from './dto/register.dto';
import { ResendActivationDto } from './dto/resend-activation.dto';
import { TokenDto } from './dto/token.dto';
import { UsernameAvailableDto } from './dto/username-available.dto';
import { UsernameAvailableResponse } from './dto/username-available.response';
import { ActivationService } from './activation.service';
import { RegistrationService } from './registration.service';

@Public()
@ApiTags('Auth')
@Controller('api/internal/auth')
export class RegistrationController {
  constructor(
    private readonly registration: RegistrationService,
    private readonly activation: ActivationService,
  ) {}

  /**
   * Create an account
   *
   * @remarks
   * Public. Creates an inactive account and mails an activation link (valid 7 days); the account cannot sign in until it is activated. Optionally joins an open, listed organization and sets the default language.
   * Limited to 5 attempts per IP per hour, every attempt counts. Errors: 400 `validation_failed` with per-field issues (`username_taken`, `email_taken`, `language_unknown`, `organization_unavailable`, password policy or breached password), 503 `mail_unavailable` when the activation mail cannot be sent (nothing is created then), 429 `rate_limited`. Returns 204.
   */
  @Post('register')
  @HttpCode(204)
  register(
    @Body() body: RegisterDto,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    return this.registration.register(body, request.ip);
  }

  /**
   * Activate an account
   *
   * @remarks
   * Public. Consumes the single-use key from the activation mail and turns the account on. Errors: 400 `invalid_token` for an unknown, used or expired key. Returns 204.
   */
  @Post('activate')
  @HttpCode(204)
  activate(@Body() body: TokenDto): Promise<void> {
    return this.registration.activate(body.token);
  }

  /**
   * Resend the activation mail
   *
   * @remarks
   * Public. Sends a fresh activation link to every pending account registered with the email. Answers 204 whether or not the email matches, so it does not reveal which emails are registered. Limited per IP and per email (10 and 3 per hour, 429 `rate_limited`); 503 `mail_unavailable` when mail is not configured.
   */
  @Post('activate/resend')
  @HttpCode(204)
  resend(
    @Body() { email }: ResendActivationDto,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    return this.activation.resend(email, request.ip);
  }

  /**
   * Check whether a username is free
   *
   * @remarks
   * Public. Returns `available` for a username that could be registered now; unactivated signups older than 7 days do not block it. Limited to 30 checks per IP per 10 minutes (429 `rate_limited`).
   */
  @Get('username-available')
  async usernameAvailable(
    @Query() { username }: UsernameAvailableDto,
    @Req() request: FastifyRequest,
  ): Promise<UsernameAvailableResponse> {
    return {
      available: await this.registration.usernameAvailable(
        username,
        request.ip,
      ),
    };
  }
}
