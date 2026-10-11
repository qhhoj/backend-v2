import { ApiTags } from '@nestjs/swagger';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  CurrentAuth,
  NoImpersonation,
  RequirePermission,
  SessionOnly,
} from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { RefuseNullFieldsPipe } from '@libs/common';
import { UsernameParamDto } from '../core/dto/username-params.dto';
import {
  RenameUserDto,
  SetUserPasswordDto,
  UpdateUserByStaffDto,
} from './dto/user-edit.dto';
import {
  RenamedUserResponse,
  UserEditResponse,
} from './dto/user-edit.response';
import { UserCredentialsService } from './user-credentials.service';
import { UserProfileEditingService } from './user-profile-editing.service';
import { UserRenameService } from './user-rename.service';

/** Staff edit other users from a browser session (API tokens get 403). Not while impersonating: the impersonated user's rights and password would apply. */
@SessionOnly()
@NoImpersonation()
@ApiTags('Admin: users')
@Controller('api/internal/admin/users/:username')
export class UserEditingController {
  constructor(
    private readonly profiles: UserProfileEditingService,
    private readonly credentials: UserCredentialsService,
    private readonly renames: UserRenameService,
  ) {}

  /**
   * Get a user's editable profile
   *
   * @remarks
   * Requires `judge.change_profile` and a browser session. Returns the display name, full name, about text, e-mail and organizations. Errors: 403 `forbidden` for a superuser unless you are one, 404 `not_found`.
   */
  @Get('profile')
  @RequirePermission('judge.change_profile')
  get(
    @CurrentAuth() auth: AuthContext,
    @Param() { username }: UsernameParamDto,
  ): Promise<UserEditResponse> {
    return this.profiles.get(auth.principal, username);
  }

  /**
   * Edit a user's profile
   *
   * @remarks
   * Requires `judge.change_profile` and a browser session; changing `email` or `isActive` also needs `auth.change_user` (403 `forbidden`, issue `email_not_editable` or `activation_not_editable`), and an `email` change also your own `currentPassword` (400 `validation_failed` issue `password_required`, 400 `invalid_credentials`) and spends the credential budget shared with password sets (10 per admin per hour). An e-mail change keeps the user's sessions and reset links already sent: to recover a hijacked account, set a password. Not on yourself. Absent fields stay unchanged, `null` is refused; every check runs before the first write (a write that loses a race keeps the earlier ones, all audited). `organizations` replaces the whole ordered list (staff bypass the open-organization cap); deactivating signs the user out everywhere and revokes the API token. Every change is recorded as a `user` revision `staff_edit`.
   * Errors: 400 `validation_failed` with issues `email_invalid`, `password_required`, `email_taken`, `organization_unknown`, `organization_admin_member` (the user administers a dropped organization); 403 `forbidden` for yourself or a superuser unless you are one; 404 `not_found`; 409 `conflict` with issue `user_banned` (a banned account keeps its rank and unlisting and is reactivated by unbanning), or when the memberships changed meanwhile or the e-mail is being registered.
   */
  @Patch('profile')
  @RequirePermission('judge.change_profile')
  update(
    @CurrentAuth() auth: AuthContext,
    @Param() { username }: UsernameParamDto,
    @Body(new RefuseNullFieldsPipe()) dto: UpdateUserByStaffDto,
  ): Promise<UserEditResponse> {
    return this.profiles.update(auth, username, dto);
  }

  /**
   * Set a user's password
   *
   * @remarks
   * Requires `auth.change_user`, a browser session, and your own current password (`currentPassword`; wrong attempts share the 10 in 15 minutes budget with other password confirmations: 400 `invalid_credentials`, then 429 `rate_limited`). At most 10 credential changes (password sets and e-mail changes) per admin per hour (429 `rate_limited`).
   * The new password must pass the signup policy and not appear in a known breach (400 `validation_failed`, issues on `newPassword`). Signs the user out everywhere and revokes their API token; recorded as a `user` revision `staff_set_password` without the password.
   * Errors: 403 `forbidden` for yourself or a superuser unless you are one, 404 `not_found`, 409 `conflict` on a concurrent change. Returns 204.
   */
  @Post('password')
  @HttpCode(204)
  @RequirePermission('auth.change_user')
  setPassword(
    @CurrentAuth() auth: AuthContext,
    @Param() { username }: UsernameParamDto,
    @Body() dto: SetUserPasswordDto,
  ): Promise<void> {
    return this.credentials.setPassword(auth, username, dto);
  }

  /**
   * Send a password reset link
   *
   * @remarks
   * Requires `auth.change_user` and a browser session. Mails the user the same link as the public reset form, sharing its per-address budget (3 per hour, then 429 `rate_limited`); recorded as a `user` revision `staff_send_reset_link`.
   * Errors: 403 `forbidden` for yourself or a superuser unless you are one, 404 `not_found`, 409 `conflict` with issue `account_inactive` or `email_missing`, 503 `mail_unavailable` when mail is not configured. Returns 204.
   */
  @Post('password-reset')
  @HttpCode(204)
  @RequirePermission('auth.change_user')
  sendResetLink(
    @CurrentAuth() auth: AuthContext,
    @Param() { username }: UsernameParamDto,
  ): Promise<void> {
    return this.credentials.sendResetLink(auth, username);
  }

  /**
   * Rename a user
   *
   * @remarks
   * Requires `auth.change_user` and a browser session; not yourself. Changes the login name (a case-only change is allowed); the old name keeps opening the profile while no account holds it. Recorded as a `user` revision `staff_rename`.
   * Errors: 400 `validation_failed` with issue `username_invalid_characters` or `username_taken`; 403 `forbidden` for yourself or a superuser unless you are one; 404 `not_found`; 409 `conflict` when renamed meanwhile.
   */
  @Post('rename')
  @HttpCode(200)
  @RequirePermission('auth.change_user')
  rename(
    @CurrentAuth() auth: AuthContext,
    @Param() { username }: UsernameParamDto,
    @Body() dto: RenameUserDto,
  ): Promise<RenamedUserResponse> {
    return this.renames.rename(auth.principal, username, dto.username);
  }
}
