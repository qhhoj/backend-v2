import { Controller, Get, Param } from '@nestjs/common';
import { CurrentAuth } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { ProblemCodeParamDto } from '../../problems/core/dto/problem-params.dto';
import { ArchivedInResponse } from './dto/archived-in.response';
import { ArchiveNoticeService } from './archive-notice.service';

/** Registered by the organizations module, mounted beside the problem routes: no organization slug can shadow it. */
@Controller('api/internal/problems')
export class ArchiveNoticeController {
  constructor(private readonly notice: ArchiveNoticeService) {}

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
