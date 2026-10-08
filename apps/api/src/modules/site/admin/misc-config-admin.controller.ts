import { Body, Controller, Delete, HttpCode, Param, Put } from '@nestjs/common';
import { RequirePermission } from '@libs/auth';
import { PutMiscConfigDto } from './dto/misc-config-admin.dto';
import { MiscConfigResponse } from './dto/misc-config.response';
import { ConfigKeyParamDto } from './dto/site-admin-params.dto';
import { MiscConfigAdminService } from './misc-config-admin.service';

/** Config is public (`GET /site` serves every key to everyone): no secrets. No admin read either. */
@RequirePermission('judge.change_miscconfig')
@Controller('api/internal/admin/site/config')
export class MiscConfigAdminController {
  constructor(private readonly config: MiscConfigAdminService) {}

  @Put(':key')
  put(
    @Param() { key }: ConfigKeyParamDto,
    @Body() { value }: PutMiscConfigDto,
  ): Promise<MiscConfigResponse> {
    return this.config.put(key, value);
  }

  @Delete(':key')
  @HttpCode(204)
  delete(@Param() { key }: ConfigKeyParamDto): Promise<void> {
    return this.config.delete(key);
  }
}
