import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentAuth, RequirePermission } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { BulkVisibilityDto } from './dto/bulk-visibility.dto';
import { BulkVisibilityResponse } from './dto/bulk-visibility.response';
import { ProblemBulkVisibilityService } from './problem-bulk-visibility.service';

@ApiTags('Problem editing')
@Controller('api/internal/problems/bulk')
export class ProblemBulkVisibilityController {
  constructor(private readonly bulk: ProblemBulkVisibilityService) {}

  /**
   * Publish or unpublish problems in bulk
   *
   * @remarks
   * Needs `judge.change_public_visibility`. Applies `isPublic` to each listed
   * problem exactly as `PATCH /problems/{code}` would: the caller needs edit
   * rights on each, every change writes a revision and rescores. With
   * `setDateToNow` a publish also sets the publication date to now (needs
   * `judge.edit_all_problem`). A refused problem is reported as `failed` with
   * the PATCH's error code (`internal_error` for an unexpected failure) and does not stop the others. Limited to 20 runs per
   * hour per user (429 `rate_limited`).
   */
  @RequirePermission('judge.change_public_visibility')
  @Post('visibility')
  @HttpCode(200)
  visibility(
    @CurrentAuth() auth: AuthContext,
    @Body() body: BulkVisibilityDto,
  ): Promise<BulkVisibilityResponse> {
    return this.bulk.run(auth.principal, body);
  }
}
