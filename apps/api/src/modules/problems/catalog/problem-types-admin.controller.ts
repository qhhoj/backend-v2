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
import { ProblemTypesAdminService } from './problem-taxa-admin.service';

@ApiTags('Problem editing')
@Controller('api/internal/admin/problem-types')
export class ProblemTypesAdminController {
  constructor(private readonly catalog: ProblemTypesAdminService) {}

  /**
   * List problem types
   *
   * @remarks
   * Needs `judge.change_problemtype`. Returns every problem type, sorted by name
   * ignoring case.
   */
  @RequirePermission('judge.change_problemtype')
  @Get()
  list(): Promise<CatalogItemResponse[]> {
    return this.catalog.list();
  }

  /**
   * Add a problem type
   *
   * @remarks
   * Needs `judge.add_problemtype`. Responds 409 `conflict` when the name is
   * taken (ignoring case). Writes a revision; the change takes effect on this
   * server at once and on others through the change stream.
   */
  @RequirePermission('judge.add_problemtype')
  @Post()
  create(
    @CurrentAuth() auth: AuthContext,
    @Body() body: CreateTaxonDto,
  ): Promise<CatalogItemResponse> {
    return this.catalog.create(auth.principal.userId, body);
  }

  /**
   * Update a problem type
   *
   * @remarks
   * Needs `judge.change_problemtype`. Send only the fields to change; none accepts
   * null. Responds 404 `not_found` for an unknown id and 409 `conflict` when
   * the new name is taken. There is no delete: problems reference the
   * row.
   */
  @RequirePermission('judge.change_problemtype')
  @Patch(':id')
  update(
    @CurrentAuth() auth: AuthContext,
    @Param() { id }: CatalogIdParamDto,
    @Body(new RefuseNullFieldsPipe()) body: UpdateTaxonDto,
  ): Promise<CatalogItemResponse> {
    return this.catalog.update(auth.principal.userId, id, body);
  }
}
