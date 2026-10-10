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
import { CurrentAuth, RequirePermission } from '@libs/auth';
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
   * Requires `judge.change_settings`. Returns every registered setting with its description, current value, default and whether it differs from the default. Secret parts (keys, passwords) are never returned; they read `{set: boolean}`.
   */
  @Get()
  list(): Promise<SettingResponse[]> {
    return this.settings.list();
  }

  /**
   * Change a site setting
   *
   * @remarks
   * Requires `judge.change_settings`. Sets the value of one setting and records a revision with the acting user. Object-valued settings are merged into the stored value. `null` is refused. Errors: 400 `validation_failed` on `value` when it does not fit the setting, 404 `not_found` for an unknown key.
   */
  @Patch(':key')
  update(
    @CurrentAuth() auth: AuthContext,
    @Param() { key }: SettingKeyParamDto,
    @Body(new RefuseNullFieldsPipe()) { value }: UpdateSettingDto,
  ): Promise<SettingResponse> {
    return this.settings.update(key, value, auth.principal.userId);
  }

  /**
   * Restore a setting to an earlier revision
   *
   * @remarks
   * Requires `judge.change_settings`. Writes the value the setting had before the given revision, as a new revision. Secret values are not stored in revisions, so they are never restored. Errors: 404 `not_found` for an unknown setting or revision, 409 `secret_unrestorable` when the revision has nothing restorable because the value is secret.
   */
  @HttpCode(200)
  @Post(':key/revisions/:revisionId/restore')
  restore(
    @CurrentAuth() auth: AuthContext,
    @Param() { key, revisionId }: SettingRevisionParamDto,
  ): Promise<SettingResponse> {
    return this.settings.restore(key, revisionId, auth.principal.userId);
  }

  /**
   * List the revisions of a setting
   *
   * @remarks
   * Requires `judge.change_settings`. Returns the change history of one setting, newest first, with the values before and after, the changed fields and the acting user. Paged, default 20 per page (max 100). 404 `not_found` for an unknown key.
   */
  @ApiPaginatedResponse(SettingRevisionResponse)
  @Get(':key/revisions')
  revisions(
    @Param() { key }: SettingKeyParamDto,
    @Query() { page, pageSize }: SettingRevisionsQueryDto,
  ): Promise<Paginated<SettingRevisionResponse>> {
    return this.settings.revisions(key, page, pageSize);
  }
}
