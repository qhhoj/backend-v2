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
@Controller('api/internal/auth')
export class RegistrationController {
  constructor(
    private readonly registration: RegistrationService,
    private readonly activation: ActivationService,
  ) {}

  @Post('register')
  @HttpCode(204)
  register(
    @Body() body: RegisterDto,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    return this.registration.register(body, request.ip);
  }

  @Post('activate')
  @HttpCode(204)
  activate(@Body() body: TokenDto): Promise<void> {
    return this.registration.activate(body.token);
  }

  @Post('activate/resend')
  @HttpCode(204)
  resend(
    @Body() { email }: ResendActivationDto,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    return this.activation.resend(email, request.ip);
  }

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
