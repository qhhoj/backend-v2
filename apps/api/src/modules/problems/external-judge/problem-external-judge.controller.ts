import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentAuth } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { ProblemCodeParamDto } from '../core/dto/problem-params.dto';
import {
  ExternalJudgeSearchDto,
  ExternalJudgeVerifyDto,
  PutExternalJudgeDto,
} from './dto/external-judge.dto';
import {
  ExternalJudgeSearchResponse,
  ExternalJudgeVerifyResponse,
  ProblemExternalJudgeResponse,
} from './dto/external-judge.response';
import { ExternalJudgeLookupService } from './external-judge-lookup.service';
import { ProblemExternalJudgeService } from './problem-external-judge.service';

@ApiTags('Problem editing')
@Controller('api/internal/problems/:code/external-judge')
export class ProblemExternalJudgeController {
  constructor(
    private readonly links: ProblemExternalJudgeService,
    private readonly lookups: ExternalJudgeLookupService,
  ) {}

  /**
   * Get a problem's external judge link
   *
   * @remarks
   * Needs edit rights on the problem (404 `not_found` when invisible, 403
   * `forbidden` when not editable). `connected` tells whether the site has an
   * external judge configured; `link` is null when the problem has none.
   */
  @Get()
  get(
    @CurrentAuth() auth: AuthContext,
    @Param() { code }: ProblemCodeParamDto,
  ): Promise<ProblemExternalJudgeResponse> {
    return this.links.get(auth, code);
  }

  /**
   * Set a problem's external judge link
   *
   * @remarks
   * Needs edit rights on the problem. Replaces the link: the remote OJ and
   * problem and the site-to-remote language mapping. Every language must exist
   * and take typed source (400 `validation_failed`). While `isActive`, the
   * problem's allowed languages become exactly the mapped ones and its
   * submissions are judged by the external judge. Writes a revision.
   */
  @Put()
  put(
    @CurrentAuth() auth: AuthContext,
    @Param() { code }: ProblemCodeParamDto,
    @Body() body: PutExternalJudgeDto,
  ): Promise<ProblemExternalJudgeResponse> {
    return this.links.put(auth, code, body);
  }

  /**
   * Remove a problem's external judge link
   *
   * @remarks
   * Needs edit rights on the problem. The problem is judged by judge-v2 again;
   * its allowed languages are left as they are.
   */
  @Delete()
  remove(
    @CurrentAuth() auth: AuthContext,
    @Param() { code }: ProblemCodeParamDto,
  ): Promise<ProblemExternalJudgeResponse> {
    return this.links.remove(auth, code);
  }

  /**
   * Search the external judge's problems
   *
   * @remarks
   * Needs edit rights on the problem. Give an OJ, a problem id or both (400
   * `validation_failed` otherwise). Limited to 30 lookups a minute per user
   * (429 `rate_limited`). External judge errors: 409
   * `external_judge_not_configured`, 502 `external_judge_unauthorized`, 502
   * `external_judge_rejected`, 503 `external_judge_unavailable`.
   */
  @Post('search')
  @HttpCode(200)
  search(
    @CurrentAuth() auth: AuthContext,
    @Param() { code }: ProblemCodeParamDto,
    @Body() body: ExternalJudgeSearchDto,
  ): Promise<ExternalJudgeSearchResponse> {
    return this.lookups.search(auth, code, body);
  }

  /**
   * Verify a remote problem
   *
   * @remarks
   * Needs edit rights on the problem. Reads the remote problem's title and
   * languages, each with the site language it most likely maps to (null when
   * no good match). Same limit and errors as search; 404
   * `external_judge_not_found` when the remote problem does not exist.
   */
  @Post('verify')
  @HttpCode(200)
  verify(
    @CurrentAuth() auth: AuthContext,
    @Param() { code }: ProblemCodeParamDto,
    @Body() body: ExternalJudgeVerifyDto,
  ): Promise<ExternalJudgeVerifyResponse> {
    return this.lookups.verify(auth, code, body);
  }
}
