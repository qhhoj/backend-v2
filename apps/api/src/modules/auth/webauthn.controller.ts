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
  NoImpersonation,
  SessionOnly,
} from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/server';
import { CurrentPasswordDto } from './dto/current-password.dto';
import { WebauthnLoginDto, WebauthnRegisterDto } from './dto/webauthn.dto';
import { WebauthnService } from './webauthn.service';

@Controller('api/internal/auth/2fa/webauthn')
export class WebauthnController {
  constructor(private readonly webauthn: WebauthnService) {}

  @SessionOnly()
  @NoImpersonation()
  @Post('register/options')
  registrationOptions(
    @CurrentAuth() auth: AuthContext,
    @Body() body: CurrentPasswordDto,
  ): Promise<PublicKeyCredentialCreationOptionsJSON> {
    return this.webauthn.registrationOptions(auth, body.currentPassword);
  }

  @SessionOnly()
  @NoImpersonation()
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
  @NoImpersonation()
  @Delete('credentials/:credentialId')
  @HttpCode(204)
  remove(
    @CurrentAuth() auth: AuthContext,
    @Param('credentialId') credentialId: string,
  ) {
    return this.webauthn.remove(auth, credentialId);
  }
}
