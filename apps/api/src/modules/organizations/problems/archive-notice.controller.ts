import { ApiParam, ApiTags } from '@nestjs/swagger';
import { Controller, Get, Param } from '@nestjs/common';
import { CurrentAuth } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { ProblemCodeParamDto } from '../../problems/core/dto/problem-params.dto';
import { ArchivedInResponse } from './dto/archived-in.response';
import { ArchiveNoticeService } from './archive-notice.service';

/** Registered by the organizations module, mounted beside the problem routes: no organization slug can shadow it. */
@ApiTags('Organizations')
@Controller('api/internal/problems')
export class ArchiveNoticeController {
  constructor(private readonly notice: ArchiveNoticeService) {}

  /**
   * List the viewer's organizations that archived a problem
   *
   * @remarks
   * Returns the organizations (slug and name) in which the viewer is a member
   * or administrator and which archived the problem, for the notice on the
   * problem page. Fails with 404 `not_found` when the viewer cannot see the
   * problem.
   */
  @ApiParam({ name: 'code', description: 'Code of the problem.' })
  @Get(':code/archived-in')
  async archivedIn(
    @CurrentAuth() auth: AuthContext,
    @Param() { code }: ProblemCodeParamDto,
  ): Promise<ArchivedInResponse> {
    return {
      organizations: await this.notice.organizationsFor(auth.principal, code),
    };
  }
}
