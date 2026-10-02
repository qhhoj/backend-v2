import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Public } from '@libs/auth';
import { RegisterDto } from './dto/register.dto';
import { TokenDto } from './dto/token.dto';
import { RegistrationService } from './registration.service';

@Public()
@Controller('api/internal/auth')
export class RegistrationController {
  constructor(private readonly registration: RegistrationService) {}

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
}
