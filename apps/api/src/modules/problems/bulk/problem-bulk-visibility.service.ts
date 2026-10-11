import { Injectable, Logger } from '@nestjs/common';
import type { Principal } from '@libs/auth';
import { AppError, RateLimitService } from '@libs/common';
import { ProblemEditingService } from '../editing/problem-editing.service';
import type { UpdateProblemDto } from '../editing/dto/problem-edit.dto';
import type { BulkVisibilityDto } from './dto/bulk-visibility.dto';
import type {
  BulkVisibilityResponse,
  BulkVisibilityResultResponse,
} from './dto/bulk-visibility.response';

/** Per user: each run may rescore up to 100 problems. */
const BULK_LIMIT = 20;
const BULK_WINDOW_SECONDS = 60 * 60;

/** Legacy admin actions `make_public_and_update_publish_date` and `make_private`, one PATCH per problem so each keeps its gates, revision and rescore. */
@Injectable()
export class ProblemBulkVisibilityService {
  private readonly logger = new Logger(ProblemBulkVisibilityService.name);

  constructor(
    private readonly editing: ProblemEditingService,
    private readonly rateLimit: RateLimitService,
  ) {}

  /** Codes run one after another; a refused or crashed code is reported and the rest still apply, so the answer always says which ones changed. */
  async run(
    principal: Principal,
    dto: BulkVisibilityDto,
  ): Promise<BulkVisibilityResponse> {
    await this.rateLimit.reserve(
      [`problems-bulk-visibility:user:${principal.userId}`],
      BULK_LIMIT,
      BULK_WINDOW_SECONDS,
    );
    const patch = patchOf(dto);
    const results: BulkVisibilityResultResponse[] = [];
    for (const code of dto.codes)
      results.push(await this.applyOne(principal, code, patch));
    return {
      results,
      done: results.filter((result) => result.outcome === 'done').length,
      failed: results.filter((result) => result.outcome === 'failed').length,
    };
  }

  private async applyOne(
    principal: Principal,
    code: string,
    patch: UpdateProblemDto,
  ): Promise<BulkVisibilityResultResponse> {
    try {
      const { isChanged } = await this.editing.applyEdit(
        principal,
        code,
        patch,
      );
      return { code, outcome: isChanged ? 'done' : 'unchanged' };
    } catch (error) {
      if (error instanceof AppError)
        return { code, outcome: 'failed', reason: error.code };
      this.logger.error(
        `Bulk visibility failed on ${code}`,
        error instanceof Error ? error.stack : String(error),
      );
      return { code, outcome: 'failed', reason: 'internal_error' };
    }
  }
}

function patchOf(dto: BulkVisibilityDto): UpdateProblemDto {
  const isDated = dto.isPublic && dto.setDateToNow === true;
  return {
    isPublic: dto.isPublic,
    ...(isDated ? { date: new Date().toISOString() } : {}),
    changeMessage:
      dto.changeMessage?.trim() ||
      (dto.isPublic ? 'Published in bulk' : 'Made private in bulk'),
  };
}
