import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '@libs/auth';
import { ExternalJudgeStatusResponse } from './dto/external-judge.response';
import { ExternalJudgeStatusService } from './external-judge-status.service';

@ApiTags('Judging')
@Public()
@Controller('api/external-judge')
export class ExternalJudgeStatusController {
  constructor(private readonly statuses: ExternalJudgeStatusService) {}

  /**
   * External judge status
   *
   * @remarks
   * Public. Whether an external judge is configured and whether its OJ list
   * could be read, with the OJ ids. The check runs at most once a minute per
   * server process; the base URL and the token are never shown.
   */
  @Get('status')
  status(): Promise<ExternalJudgeStatusResponse> {
    return this.statuses.status();
  }
}
