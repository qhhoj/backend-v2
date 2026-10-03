import { Controller, Get } from '@nestjs/common';
import { Public } from '@libs/auth';
import { ProblemMetaResponse } from './dto/problem-meta.response';
import { ProblemsService } from './problems.service';

@Controller('api/internal/problems')
export class ProblemsController {
  constructor(private readonly problems: ProblemsService) {}

  @Public()
  @Get('meta')
  meta(): ProblemMetaResponse {
    return this.problems.meta();
  }
}
