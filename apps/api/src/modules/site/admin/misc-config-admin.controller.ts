import { ApiTags } from '@nestjs/swagger';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Put,
  Query,
} from '@nestjs/common';
import { CurrentAuth, RequirePermission } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { ApiPaginatedResponse } from '@libs/common';
import type { Paginated } from '@libs/common';
import { FlatpageRevisionResponse } from './dto/flatpage-revision.response';
import { PutMiscConfigDto } from './dto/misc-config-admin.dto';
import { MiscConfigResponse } from './dto/misc-config.response';
import {
  ConfigKeyParamDto,
  PageListQueryDto,
} from './dto/site-admin-params.dto';
import { MiscConfigAdminService } from './misc-config-admin.service';

/** Config is public (`GET /site` serves every key to everyone): no secrets, and no admin read of values besides the history. */
@RequirePermission('judge.change_miscconfig')
@ApiTags('Admin: site & settings')
@Controller('api/internal/admin/site/config')
export class MiscConfigAdminController {
  constructor(private readonly config: MiscConfigAdminService) {}

  /**
   * Set a public config value
   *
   * @remarks
   * Requires `judge.change_miscconfig`. Creates or replaces a free-form key/value text served to everyone by `GET /site`, so it must never hold a secret. The empty string is a valid value. A changed value records a revision.
   */
  @Put(':key')
  put(
    @CurrentAuth() auth: AuthContext,
    @Param() { key }: ConfigKeyParamDto,
    @Body() { value }: PutMiscConfigDto,
  ): Promise<MiscConfigResponse> {
    return this.config.put(auth.principal, key, value);
  }

  /**
   * Show the history of a config key
   *
   * @remarks
   * Requires `judge.change_miscconfig`. The key's changes (creation, edits, deletion), newest first, 20 per page, with the editor and the value before and after. Still readable after the key is deleted; an unknown key has an empty history.
   */
  @ApiPaginatedResponse(FlatpageRevisionResponse)
  @Get(':key/revisions')
  revisions(
    @Param() { key }: ConfigKeyParamDto,
    @Query() { page }: PageListQueryDto,
  ): Promise<Paginated<FlatpageRevisionResponse>> {
    return this.config.revisionsOf(key, page);
  }

  /**
   * Delete a public config value
   *
   * @remarks
   * Requires `judge.change_miscconfig`. Removes the key and records a revision. 404 `not_found` if it does not exist. Returns 204.
   */
  @Delete(':key')
  @HttpCode(204)
  delete(
    @CurrentAuth() auth: AuthContext,
    @Param() { key }: ConfigKeyParamDto,
  ): Promise<void> {
    return this.config.delete(auth.principal, key);
  }
}
