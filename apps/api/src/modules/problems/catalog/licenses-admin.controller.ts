import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentAuth, RequirePermission } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { RefuseNullFieldsPipe } from '@libs/common';
import {
  CatalogIdParamDto,
  CreateLicenseDto,
  UpdateLicenseDto,
} from './dto/catalog-admin.dto';
import { LicenseAdminResponse } from './dto/license-admin.response';
import { LicensesAdminService } from './licenses-admin.service';

@ApiTags('Problem editing')
@Controller('api/internal/admin/licenses')
export class LicensesAdminController {
  constructor(private readonly catalog: LicensesAdminService) {}

  /**
   * List problem licenses
   *
   * @remarks
   * Needs `judge.change_license`. Returns every license, sorted by key
   * ignoring case, with the markdown text the public catalog omits.
   */
  @RequirePermission('judge.change_license')
  @Get()
  list(): Promise<LicenseAdminResponse[]> {
    return this.catalog.list();
  }

  /**
   * Add a license
   *
   * @remarks
   * Needs `judge.add_license`. Responds 409 `conflict` when the key is
   * taken (ignoring case). Writes a revision; the change takes effect on this
   * server at once and on others through the change stream.
   */
  @RequirePermission('judge.add_license')
  @Post()
  create(
    @CurrentAuth() auth: AuthContext,
    @Body() body: CreateLicenseDto,
  ): Promise<LicenseAdminResponse> {
    return this.catalog.create(auth.principal.userId, body);
  }

  /**
   * Update a license
   *
   * @remarks
   * Needs `judge.change_license`. Send only the fields to change; none accepts
   * null. Responds 404 `not_found` for an unknown id and 409 `conflict` when
   * the new key is taken. There is no delete: problems reference the
   * row.
   */
  @RequirePermission('judge.change_license')
  @Patch(':id')
  update(
    @CurrentAuth() auth: AuthContext,
    @Param() { id }: CatalogIdParamDto,
    @Body(new RefuseNullFieldsPipe()) body: UpdateLicenseDto,
  ): Promise<LicenseAdminResponse> {
    return this.catalog.update(auth.principal.userId, id, body);
  }
}
