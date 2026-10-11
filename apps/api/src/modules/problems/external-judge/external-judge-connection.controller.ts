import { Controller, HttpCode, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '@libs/auth';
import { ExternalJudgeClient } from '@libs/judging';
import { ExternalJudgeTestResponse } from './dto/external-judge.response';
import { askExternalJudge } from './external-judge-errors';

@ApiTags('Admin: site & settings')
@RequirePermission('judge.change_settings')
@Controller('api/internal/external-judge')
export class ExternalJudgeConnectionController {
  constructor(private readonly client: ExternalJudgeClient) {}

  /**
   * Test the external judge connection
   *
   * @remarks
   * Needs `judge.change_settings`. Calls the external judge's OJ list with the
   * saved base URL and token and answers the OJ ids it serves. Errors: 409
   * `external_judge_not_configured`, 502 `external_judge_unauthorized`, 404
   * `external_judge_not_found`, 502 `external_judge_rejected`, 503
   * `external_judge_unavailable`. Messages never carry the URL or the token.
   */
  @Post('test')
  @HttpCode(200)
  async test(): Promise<ExternalJudgeTestResponse> {
    const ojs = await askExternalJudge(() => this.client.ojs());
    return { ok: true, ojs: ojs.map(({ oj }) => oj) };
  }
}
