import { Injectable } from '@nestjs/common';
import type { Principal } from '@libs/auth';
import { AppError, Paginated } from '@libs/common';
import { SubmissionListItemResponse } from '../core/dto/submission-list.response';
import { SubmissionsService } from '../core/submissions.service';
import { BestSubmissionsRepository } from './best-submissions.repository';

@Injectable()
export class BestSubmissionsService {
  constructor(
    private readonly submissions: SubmissionsService,
    private readonly best: BestSubmissionsRepository,
  ) {}

  /** The problem's best submission of each user, under the submission list's visibility rules; 404 for a problem the list would show nothing of. */
  async list(
    principal: Principal | null,
    code: string,
    { page, pageSize }: { page: number; pageSize: number },
  ): Promise<Paginated<SubmissionListItemResponse>> {
    const filter = await this.submissions.filterFor(
      principal,
      { problem: code },
      await this.submissions.viewerScope(principal),
    );
    if (!filter) throw new AppError('not_found', 404, 'No such problem');
    const { items, total } = await this.best.page(filter, page, pageSize);
    const rows = await this.submissions.listItems(items, principal, {
      testSummaries: false,
    });
    return new Paginated(rows, {
      page,
      pageSize,
      total,
    });
  }
}
