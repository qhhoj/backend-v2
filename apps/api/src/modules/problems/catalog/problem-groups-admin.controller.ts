import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentAuth, RequirePermission } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { RefuseNullFieldsPipe } from '@libs/common';
import {
  CatalogIdParamDto,
  CreateTaxonDto,
  UpdateTaxonDto,
} from './dto/catalog-admin.dto';
import { CatalogItemResponse } from '../core/dto/problem-meta.response';
import { ProblemGroupsAdminService } from './problem-taxa-admin.service';

@ApiTags('Problem editing')
@Controller('api/internal/admin/problem-groups')
export class ProblemGroupsAdminController {
  constructor(private readonly catalog: ProblemGroupsAdminService) {}

  /**
   * List problem groups
   *
   * @remarks
   * Needs `judge.change_problemgroup`. Returns every problem group, sorted by name
   * ignoring case.
   */
  @RequirePermission('judge.change_problemgroup')
  @Get()
  list(): Promise<CatalogItemResponse[]> {
    return this.catalog.list();
  }

  /**
   * Add a problem group
   *
   * @remarks
   * Needs `judge.add_problemgroup`. Responds 409 `conflict` when the name is
   * taken (ignoring case). Writes a revision; the change takes effect on this
   * server at once and on others through the change stream.
   */
  @RequirePermission('judge.add_problemgroup')
  @Post()
  create(
    @CurrentAuth() auth: AuthContext,
    @Body() body: CreateTaxonDto,
  ): Promise<CatalogItemResponse> {
    return this.catalog.create(auth.principal.userId, body);
  }

  /**
   * Update a problem group
   *
   * @remarks
   * Needs `judge.change_problemgroup`. Send only the fields to change; none accepts
   * null. Responds 404 `not_found` for an unknown id and 409 `conflict` when
   * the new name is taken. There is no delete: problems reference the
   * row.
   */
  @RequirePermission('judge.change_problemgroup')
  @Patch(':id')
  update(
    @CurrentAuth() auth: AuthContext,
    @Param() { id }: CatalogIdParamDto,
    @Body(new RefuseNullFieldsPipe()) body: UpdateTaxonDto,
  ): Promise<CatalogItemResponse> {
    return this.catalog.update(auth.principal.userId, id, body);
  }
}
