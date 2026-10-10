import { ApiTags } from '@nestjs/swagger';
import { Body, Controller, Delete, HttpCode, Param, Put } from '@nestjs/common';
import { RequirePermission } from '@libs/auth';
import { PutMiscConfigDto } from './dto/misc-config-admin.dto';
import { MiscConfigResponse } from './dto/misc-config.response';
import { ConfigKeyParamDto } from './dto/site-admin-params.dto';
import { MiscConfigAdminService } from './misc-config-admin.service';

/** Config is public (`GET /site` serves every key to everyone): no secrets. No admin read either. */
@RequirePermission('judge.change_miscconfig')
@ApiTags('Admin: site & settings')
@Controller('api/internal/admin/site/config')
export class MiscConfigAdminController {
  constructor(private readonly config: MiscConfigAdminService) {}

  /**
   * Set a public config value
   *
   * @remarks
   * Requires `judge.change_miscconfig`. Creates or replaces a free-form key/value text served to everyone by `GET /site`, so it must never hold a secret. The empty string is a valid value.
   */
  @Put(':key')
  put(
    @Param() { key }: ConfigKeyParamDto,
    @Body() { value }: PutMiscConfigDto,
  ): Promise<MiscConfigResponse> {
    return this.config.put(key, value);
  }

  /**
   * Delete a public config value
   *
   * @remarks
   * Requires `judge.change_miscconfig`. Removes the key. 404 `not_found` if it does not exist. Returns 204.
   */
  @Delete(':key')
  @HttpCode(204)
  delete(@Param() { key }: ConfigKeyParamDto): Promise<void> {
    return this.config.delete(key);
  }
}
