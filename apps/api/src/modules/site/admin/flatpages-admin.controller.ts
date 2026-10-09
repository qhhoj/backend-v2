import {
  Body,
  Controller,
  Delete,
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
  RefuseNullFieldsPipe,
  RenderPreviewResponse,
} from '@libs/common';
import type { Paginated } from '@libs/common';
import { CreateFlatpageDto, UpdateFlatpageDto } from './dto/flatpage-admin.dto';
import {
  FlatpageAdminListItemResponse,
  FlatpageAdminResponse,
} from './dto/flatpage-admin.response';
import { FlatpagePreviewDto } from './dto/flatpage-preview.dto';
import {
  FlatpageDeletedResponse,
  FlatpageRevisionResponse,
} from './dto/flatpage-revision.response';
import {
  FlatpageIdParamDto,
  PageListQueryDto,
  SiteIdParamDto,
} from './dto/site-admin-params.dto';
import { FlatpageHistoryService } from './flatpage-history.service';
import { FlatpagesAdminService } from './flatpages-admin.service';

@Controller('api/internal/admin/site/pages')
export class FlatpagesAdminController {
  constructor(
    private readonly pages: FlatpagesAdminService,
    private readonly history: FlatpageHistoryService,
  ) {}

  @ApiPaginatedResponse(FlatpageAdminListItemResponse)
  @RequirePermission('flatpages.change_flatpage')
  @Get()
  list(
    @Query() { page }: PageListQueryDto,
  ): Promise<Paginated<FlatpageAdminListItemResponse>> {
    return this.pages.list(page);
  }

  @RequirePermission('flatpages.change_flatpage')
  @Post('render-preview')
  @HttpCode(200)
  preview(
    @CurrentAuth() auth: AuthContext,
    @Body() body: FlatpagePreviewDto,
  ): Promise<RenderPreviewResponse> {
    return this.history.preview(auth.principal, body);
  }

  /** Declared before `:id`, which would take `deleted` for an id. */
  @ApiPaginatedResponse(FlatpageDeletedResponse)
  @RequirePermission('flatpages.change_flatpage')
  @Get('deleted')
  deleted(
    @Query() { page }: PageListQueryDto,
  ): Promise<Paginated<FlatpageDeletedResponse>> {
    return this.history.deleted(page);
  }

  @ApiPaginatedResponse(FlatpageRevisionResponse)
  @RequirePermission('flatpages.change_flatpage')
  @Get(':id/revisions')
  revisions(
    @Param() { id }: FlatpageIdParamDto,
    @Query() { page }: PageListQueryDto,
  ): Promise<Paginated<FlatpageRevisionResponse>> {
    return this.history.history(id, page);
  }

  @RequirePermission('flatpages.change_flatpage')
  @Get(':id')
  one(@Param() { id }: SiteIdParamDto): Promise<FlatpageAdminResponse> {
    return this.pages.one(id);
  }

  @RequirePermission('flatpages.add_flatpage')
  @Post()
  create(
    @CurrentAuth() auth: AuthContext,
    @Body() body: CreateFlatpageDto,
  ): Promise<FlatpageAdminResponse> {
    return this.pages.create(auth.principal, body);
  }

  @RequirePermission('flatpages.change_flatpage')
  @Patch(':id')
  update(
    @CurrentAuth() auth: AuthContext,
    @Param() { id }: SiteIdParamDto,
    @Body(new RefuseNullFieldsPipe()) body: UpdateFlatpageDto,
  ): Promise<FlatpageAdminResponse> {
    return this.pages.update(auth.principal, id, body);
  }

  @RequirePermission('flatpages.delete_flatpage')
  @Delete(':id')
  @HttpCode(204)
  delete(
    @CurrentAuth() auth: AuthContext,
    @Param() { id }: SiteIdParamDto,
  ): Promise<void> {
    return this.pages.delete(auth.principal, id);
  }
}
