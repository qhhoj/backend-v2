import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { CurrentAuth, RequirePermission } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { Paginated, RefuseNullFieldsPipe } from '@libs/common';
import { SettingKeyParamDto } from './dto/setting-params.dto';
import { SettingRevisionsQueryDto } from './dto/setting-revisions.dto';
import { SettingResponse } from './dto/setting.response';
import { SettingRevisionResponse } from './dto/setting-revision.response';
import { UpdateSettingDto } from './dto/update-setting.dto';
import { SettingsAdminService } from './settings-admin.service';

@RequirePermission('judge.change_settings')
@Controller('api/internal/admin/settings')
export class SettingsController {
  constructor(private readonly settings: SettingsAdminService) {}

  @Get()
  list(): Promise<SettingResponse[]> {
    return this.settings.list();
  }

  @Patch(':key')
  update(
    @CurrentAuth() auth: AuthContext,
    @Param() { key }: SettingKeyParamDto,
    @Body(new RefuseNullFieldsPipe()) { value }: UpdateSettingDto,
  ): Promise<SettingResponse> {
    return this.settings.update(key, value, auth.principal.userId);
  }

  @Get(':key/revisions')
  revisions(
    @Param() { key }: SettingKeyParamDto,
    @Query() { page, pageSize }: SettingRevisionsQueryDto,
  ): Promise<Paginated<SettingRevisionResponse>> {
    return this.settings.revisions(key, page, pageSize);
  }
}
