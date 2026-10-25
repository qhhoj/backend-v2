import { ApiTags } from '@nestjs/swagger';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentAuth, RequirePermission, SessionOnly } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import {
  ApiPaginatedResponse,
  Paginated,
  RefuseNullFieldsPipe,
} from '@libs/common';
import {
  SettingKeyParamDto,
  SettingRevisionParamDto,
} from './dto/setting-params.dto';
import { SettingRevisionsQueryDto } from './dto/setting-revisions.dto';
import { SettingResponse } from './dto/setting.response';
import { SettingRevisionResponse } from './dto/setting-revision.response';
import { UpdateSettingDto } from './dto/update-setting.dto';
import { SettingsAdminService } from './settings-admin.service';

@RequirePermission('judge.change_settings')
@ApiTags('Admin: site & settings')
@Controller('api/internal/admin/settings')
export class SettingsController {
  constructor(private readonly settings: SettingsAdminService) {}

  /**
   * List site settings
   *
   * @remarks
   * Requires `judge.change_settings`. Returns every registered setting with its description, current value, default and whether it differs from the default; the superuser-only keys (see `PATCH`) only to a superuser. Secret parts (keys, passwords) are never returned; they read `{set: boolean}`.
   */
  @Get()
  list(@CurrentAuth() auth: AuthContext): Promise<SettingResponse[]> {
    return this.settings.list(auth.principal);
  }

  /**
   * Change a site setting
   *
   * @remarks
   * Requires `judge.change_settings` and a browser session (API tokens are refused); `mail.smtpUrl`, `organization.adminRoleId`, every `auth.*` key, `discord.webhooks`, `polygon.apiKey`, `polygon.apiSecret`, `polygon.accountName`, `externalJudge.baseUrl` and `externalJudge.apiToken` also need a superuser, to read as well. Sets the value of one setting and records a revision with the acting user. Object-valued settings are merged into the stored value. `null` is refused. Errors: 400 `validation_failed` on `value` when it does not fit the setting, 403 `superuser_only` on `key` for a superuser-only key, 404 `not_found` for an unknown key.
   */
  @SessionOnly()
  @Patch(':key')
  update(
    @CurrentAuth() auth: AuthContext,
    @Param() { key }: SettingKeyParamDto,
    @Body(new RefuseNullFieldsPipe()) { value }: UpdateSettingDto,
  ): Promise<SettingResponse> {
    return this.settings.update(key, value, auth.principal);
  }

  /**
   * Restore a setting to an earlier revision
   *
   * @remarks
   * Requires `judge.change_settings` and a browser session; the superuser-only keys of `PATCH` also need a superuser. Writes the value the setting had before the given revision, as a new revision. Secret values are not stored in revisions, so they are never restored. Errors: 403 `superuser_only` on `key` for a superuser-only key, 404 `not_found` for an unknown setting or revision, 409 `secret_unrestorable` when the revision has nothing restorable because the value is secret.
   */
  @SessionOnly()
  @HttpCode(200)
  @Post(':key/revisions/:revisionId/restore')
  restore(
    @CurrentAuth() auth: AuthContext,
    @Param() { key, revisionId }: SettingRevisionParamDto,
  ): Promise<SettingResponse> {
    return this.settings.restore(key, revisionId, auth.principal);
  }

  /**
   * List the revisions of a setting
   *
   * @remarks
   * Requires `judge.change_settings`; the superuser-only keys of `PATCH` also need a superuser. Returns the change history of one setting, newest first, with the values before and after, the changed fields and the acting user. Paged, default 20 per page (max 100). Errors: 403 `superuser_only` on `key` for a superuser-only key, 404 `not_found` for an unknown key.
   */
  @ApiPaginatedResponse(SettingRevisionResponse)
  @Get(':key/revisions')
  revisions(
    @CurrentAuth() auth: AuthContext,
    @Param() { key }: SettingKeyParamDto,
    @Query() { page, pageSize }: SettingRevisionsQueryDto,
  ): Promise<Paginated<SettingRevisionResponse>> {
    return this.settings.revisions(key, auth.principal, page, pageSize);
  }
}
