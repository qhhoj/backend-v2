import { ApiTags } from '@nestjs/swagger';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Query,
} from '@nestjs/common';
import { CurrentAuth } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { ApiPaginatedResponse } from '@libs/common';
import type { Paginated } from '@libs/common';
import { ShareCodeParamDto } from '../core/dto/share-params.dto';
import {
  ShareListItemResponse,
  ShareSummaryResponse,
} from '../core/dto/share.response';
import { EditShareDto, ShareListQueryDto } from './dto/my-shares.dto';
import { MySharesService } from './my-shares.service';

@ApiTags('Shares')
@Controller('api/internal/shares')
export class MySharesController {
  constructor(private readonly mine: MySharesService) {}

  /**
   * List shares
   *
   * @remarks
   * Signed-in callers only. The caller's unexpired shares, newest first, taken-down ones with their takedown. `submissionId` narrows to copies of one submission (the share dialog's "already shared"). `scope=all` lists everyone's and needs `judge.manage_share` (403 `forbidden`).
   */
  @ApiPaginatedResponse(ShareListItemResponse)
  @Get()
  list(
    @CurrentAuth() auth: AuthContext,
    @Query() query: ShareListQueryDto,
  ): Promise<Paginated<ShareListItemResponse>> {
    return this.mine.list(auth.principal, query);
  }

  /**
   * Change a share's title or expiry
   *
   * @remarks
   * The owner only (403 `forbidden`). A new `expiry` counts from now. 404 `not_found` for an unknown or expired code.
   */
  @Patch(':code')
  edit(
    @CurrentAuth() auth: AuthContext,
    @Param() { code }: ShareCodeParamDto,
    @Body() body: EditShareDto,
  ): Promise<ShareSummaryResponse> {
    return this.mine.edit(auth.principal, code, body);
  }

  /**
   * Delete a share
   *
   * @remarks
   * The owner, or staff with `judge.manage_share` (403 `forbidden` otherwise; a staff delete is audit-logged). Removes the link and its stored code at once. 404 `not_found` for an unknown or expired code. Returns 204.
   */
  @Delete(':code')
  @HttpCode(204)
  remove(
    @CurrentAuth() auth: AuthContext,
    @Param() { code }: ShareCodeParamDto,
  ): Promise<void> {
    return this.mine.remove(auth.principal, code);
  }
}
