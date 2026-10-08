import { Injectable } from '@nestjs/common';
import { UsersRepository } from '@libs/auth';
import type { Principal } from '@libs/auth';
import { Paginated, RateLimitService, unique } from '@libs/common';
import { isUuid, uuidStr } from '@libs/database';
import type { Revision } from '@libs/database';
import { UserSummaryResponse } from '../../problems/core/dto/user-summary.response';
import {
  RENDER_PREVIEW_LIMIT,
  RENDER_PREVIEW_WINDOW_SECONDS,
} from '../../problems/core/rate-limits';
import { RevisionsRepository } from '../../problems/core/revisions.repository';
import { RenderPreviewResponse } from '../../problems/editing/dto/render-preview.response';
import { renderField } from '../../problems/editing/problem-markup';
import type { FlatpagePreviewDto } from './dto/flatpage-preview.dto';
import { FlatpageRevisionResponse } from './dto/flatpage-revision.response';

const PAGE_SIZE = 20;
/** The style `FlatpagesAdminService` saves pages with, so a preview matches the public page. */
const PAGE_STYLE = 'blog';

/** Read-only history of flatpages and the sanitised preview for their editors. */
@Injectable()
export class FlatpageHistoryService {
  constructor(
    private readonly revisions: RevisionsRepository,
    private readonly users: UsersRepository,
    private readonly rateLimit: RateLimitService,
  ) {}

  /** Stays readable after the page is deleted, so the id is not checked against live pages. */
  async history(
    id: string,
    page: number,
  ): Promise<Paginated<FlatpageRevisionResponse>> {
    const { items, total } = isUuid(id)
      ? await this.revisions.page('flatpage', id, page, PAGE_SIZE)
      : { items: [], total: 0 };
    const editors = await this.editorsOf(items);
    return new Paginated(
      items.map((row) =>
        FlatpageRevisionResponse.from(
          row,
          row.userId ? (editors.get(uuidStr(row.userId)) ?? null) : null,
        ),
      ),
      { page, pageSize: PAGE_SIZE, total },
    );
  }

  /** Reserves an attempt, then renders with the same sanitiser as saving. */
  async preview(
    principal: Principal,
    dto: FlatpagePreviewDto,
  ): Promise<RenderPreviewResponse> {
    await this.rateLimit.reserve(
      [`render-preview:user:${principal.userId}`],
      RENDER_PREVIEW_LIMIT,
      RENDER_PREVIEW_WINDOW_SECONDS,
    );
    return { html: renderField(dto.content, PAGE_STYLE, 'content') };
  }

  private async editorsOf(
    rows: Revision[],
  ): Promise<Map<string, UserSummaryResponse>> {
    const ids = unique(
      rows.flatMap((row) => (row.userId ? [uuidStr(row.userId)] : [])),
    );
    const users = await this.users.findByIds(ids);
    return new Map(
      users.map((user) => [user._id, UserSummaryResponse.from(user)]),
    );
  }
}
