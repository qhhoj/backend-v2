import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { AuthContext } from '@libs/auth';
import { AppError } from '@libs/common';
import type { FastifyRequest } from 'fastify';
import { maxTestcasesFor } from './dto/limits';
import { ProblemDataService } from './problem-data.service';

/** Runs before the validation pipe, so a caller who may not write (or sends too many cases) never costs a validation pass over thousands of rows. The service repeats these checks as the authority. */
@Injectable()
export class ProblemDataWriteGuard implements CanActivate {
  constructor(private readonly data: ProblemDataService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const { principal } = request.auth as AuthContext;
    const { code } = request.params as { code: string };
    await this.data.writableProblem(principal, code);
    const cases = (request.body as { cases?: unknown } | undefined)?.cases;
    const limit = maxTestcasesFor(principal);
    if (!Array.isArray(cases) || cases.length > limit)
      throw new AppError(
        'validation_failed',
        400,
        `cases must be a list of at most ${limit} test cases`,
        { cases: [`At most ${limit} test cases.`] },
      );
    return true;
  }
}
