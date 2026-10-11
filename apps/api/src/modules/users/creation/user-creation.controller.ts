import { ApiTags } from '@nestjs/swagger';
import { Body, Controller, Post } from '@nestjs/common';
import {
  CurrentAuth,
  NoImpersonation,
  RequirePermission,
  SessionOnly,
} from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { CreateUsersDto } from './dto/user-creation.dto';
import { CreatedUserResponse } from './dto/user-creation.response';
import { UserCreationService } from './user-creation.service';

@NoImpersonation()
@ApiTags('Admin: users')
@Controller('api/internal/admin/users')
export class UserCreationController {
  constructor(private readonly creation: UserCreationService) {}

  /**
   * Create user accounts
   *
   * @remarks
   * Requires `auth.add_user` and a browser session. Creates up to 100 active accounts (no activation mail), optionally all in one organization (`organizationId`, 400 `validation_failed` issue `organization_unknown`). Each row is created or refused on its own, in request order: issues `username_invalid_characters`, `username_taken` (also a name repeated in the request), `email_invalid`, `email_taken`, `invite_needs_email_only` and the signup password policy codes on `password`.
   * A row without a password gets a generated one, returned only in this response; a row with `invite` gets an unusable password and a reset-link mail (503 `mail_unavailable` for the whole request when mail is off). Every created account is a `user` revision `staff_create`.
   */
  @SessionOnly()
  @Post()
  @RequirePermission('auth.add_user')
  create(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: CreateUsersDto,
  ): Promise<CreatedUserResponse[]> {
    return this.creation.create(auth.principal, dto);
  }
}
