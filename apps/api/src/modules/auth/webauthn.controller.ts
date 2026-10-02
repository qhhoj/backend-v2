import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common';
import {
  AllowPartialAuth,
  AllowPwnedPassword,
  CurrentAuth,
  SessionOnly,
} from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/server';
import { WebauthnLoginDto, WebauthnRegisterDto } from './dto/webauthn.dto';
import { WebauthnService } from './webauthn.service';

@Controller('api/internal/auth/2fa/webauthn')
export class WebauthnController {
  constructor(private readonly webauthn: WebauthnService) {}

  @SessionOnly()
  @Post('register/options')
  registrationOptions(
    @CurrentAuth() auth: AuthContext,
  ): Promise<PublicKeyCredentialCreationOptionsJSON> {
    return this.webauthn.registrationOptions(auth);
  }

  @SessionOnly()
  @Post('register/verify')
  register(
    @CurrentAuth() auth: AuthContext,
    @Body() body: WebauthnRegisterDto,
  ): Promise<{ id: string; name: string }> {
    return this.webauthn.register(auth, body.name, body.response);
  }

  @SessionOnly()
  @AllowPartialAuth()
  @AllowPwnedPassword()
  @Post('login/options')
  loginOptions(
    @CurrentAuth() auth: AuthContext,
  ): Promise<PublicKeyCredentialRequestOptionsJSON> {
    return this.webauthn.loginOptions(auth);
  }

  @SessionOnly()
  @AllowPartialAuth()
  @AllowPwnedPassword()
  @Post('login/verify')
  @HttpCode(204)
  login(@CurrentAuth() auth: AuthContext, @Body() body: WebauthnLoginDto) {
    return this.webauthn.login(auth, body.response);
  }

  @SessionOnly()
  @Delete('credentials/:credentialId')
  @HttpCode(204)
  remove(
    @CurrentAuth() auth: AuthContext,
    @Param('credentialId') credentialId: string,
  ) {
    return this.webauthn.remove(auth, credentialId);
  }
}
