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
import { ApiPaginatedResponse, RefuseNullFieldsPipe } from '@libs/common';
import type { Paginated } from '@libs/common';
import { CreateFlatpageDto, UpdateFlatpageDto } from './dto/flatpage-admin.dto';
import {
  FlatpageAdminListItemResponse,
  FlatpageAdminResponse,
} from './dto/flatpage-admin.response';
import { PageListQueryDto, SiteIdParamDto } from './dto/site-admin-params.dto';
import { FlatpagesAdminService } from './flatpages-admin.service';

@Controller('api/internal/admin/site/pages')
export class FlatpagesAdminController {
  constructor(private readonly pages: FlatpagesAdminService) {}

  @ApiPaginatedResponse(FlatpageAdminListItemResponse)
  @RequirePermission('flatpages.change_flatpage')
  @Get()
  list(
    @Query() { page }: PageListQueryDto,
  ): Promise<Paginated<FlatpageAdminListItemResponse>> {
    return this.pages.list(page);
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
