import { ApiTags } from '@nestjs/swagger';
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
  FlatpageListQueryDto,
  PageListQueryDto,
  SiteIdParamDto,
} from './dto/site-admin-params.dto';
import { FlatpageHistoryService } from './flatpage-history.service';
import { FlatpagesAdminService } from './flatpages-admin.service';

@ApiTags('Admin: site & settings')
@Controller('api/internal/admin/site/pages')
export class FlatpagesAdminController {
  constructor(
    private readonly pages: FlatpagesAdminService,
    private readonly history: FlatpageHistoryService,
  ) {}

  /**
   * List site pages
   *
   * @remarks
   * Requires `flatpages.change_flatpage`. Returns a page of 50 pages with their URL, title and last update, by URL; `search` keeps pages whose URL or title contains it.
   */
  @ApiPaginatedResponse(FlatpageAdminListItemResponse)
  @RequirePermission('flatpages.change_flatpage')
  @Get()
  list(
    @Query() { page, search }: FlatpageListQueryDto,
  ): Promise<Paginated<FlatpageAdminListItemResponse>> {
    return this.pages.list(page, search);
  }

  /**
   * Preview page Markdown
   *
   * @remarks
   * Requires `flatpages.change_flatpage`. Renders and sanitises the Markdown exactly as saving would and returns the HTML. Limited to 60 previews per user per minute (429 `rate_limited`).
   */
  @RequirePermission('flatpages.change_flatpage')
  @Post('render-preview')
  @HttpCode(200)
  preview(
    @CurrentAuth() auth: AuthContext,
    @Body() body: FlatpagePreviewDto,
  ): Promise<RenderPreviewResponse> {
    return this.history.preview(auth.principal, body);
  }

  /**
   * List deleted site pages
   *
   * @remarks
   * Requires `flatpages.change_flatpage`. Returns deleted pages, newest deletion first, 20 per page, with the id that keeps their history readable at `pages/{id}/revisions`.
   */
  // Declared before `:id`, which would take `deleted` for an id.
  @ApiPaginatedResponse(FlatpageDeletedResponse)
  @RequirePermission('flatpages.change_flatpage')
  @Get('deleted')
  deleted(
    @Query() { page }: PageListQueryDto,
  ): Promise<Paginated<FlatpageDeletedResponse>> {
    return this.history.deleted(page);
  }

  /**
   * Show the history of a site page
   *
   * @remarks
   * Requires `flatpages.change_flatpage`. Returns the change history (creation, edits, deletion) of a page by id, newest first, 20 per page, with the editor and the before/after of each changed field. Still readable after the page is deleted; 400 `validation_failed` for a malformed id.
   */
  @ApiPaginatedResponse(FlatpageRevisionResponse)
  @RequirePermission('flatpages.change_flatpage')
  @Get(':id/revisions')
  revisions(
    @Param() { id }: FlatpageIdParamDto,
    @Query() { page }: PageListQueryDto,
  ): Promise<Paginated<FlatpageRevisionResponse>> {
    return this.history.history(id, page);
  }

  /**
   * Get a site page for editing
   *
   * @remarks
   * Requires `flatpages.change_flatpage`. Returns the page with its Markdown source and the rendered HTML. 404 `not_found`.
   */
  @RequirePermission('flatpages.change_flatpage')
  @Get(':id')
  one(@Param() { id }: SiteIdParamDto): Promise<FlatpageAdminResponse> {
    return this.pages.one(id);
  }

  /**
   * Create a site page
   *
   * @remarks
   * Requires `flatpages.add_flatpage`. Stores a page and renders its Markdown to sanitised HTML. The URL is canonicalised (`about/` becomes `/about`). Records a revision. Errors: 400 `invalid_url`, 409 `conflict` when the URL is taken.
   */
  @RequirePermission('flatpages.add_flatpage')
  @Post()
  create(
    @CurrentAuth() auth: AuthContext,
    @Body() body: CreateFlatpageDto,
  ): Promise<FlatpageAdminResponse> {
    return this.pages.create(auth.principal, body);
  }

  /**
   * Edit a site page
   *
   * @remarks
   * Requires `flatpages.change_flatpage`. Partial update; null values are refused. Last write wins. Records a revision when something changed. Errors: 404 `not_found`, 400 `invalid_url`, 409 `conflict` when the new URL is taken.
   */
  @RequirePermission('flatpages.change_flatpage')
  @Patch(':id')
  update(
    @CurrentAuth() auth: AuthContext,
    @Param() { id }: SiteIdParamDto,
    @Body(new RefuseNullFieldsPipe()) body: UpdateFlatpageDto,
  ): Promise<FlatpageAdminResponse> {
    return this.pages.update(auth.principal, id, body);
  }

  /**
   * Delete a site page
   *
   * @remarks
   * Requires `flatpages.delete_flatpage`. Removes the page; its history stays readable and the deletion is recorded. 404 `not_found`. Returns 204.
   */
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
