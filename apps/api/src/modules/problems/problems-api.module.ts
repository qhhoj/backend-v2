import { Module } from '@nestjs/common';
import { AuthModule } from '@libs/auth';
import { LanguagesQuerier } from './languages.querier';
import { LicensesQuerier } from './licenses.querier';
import { ProblemGroupsQuerier } from './problem-groups.querier';
import { ProblemTypesQuerier } from './problem-types.querier';
import { ProblemEditingController } from './problem-editing.controller';
import { ProblemEditingService } from './problem-editing.service';
import { ProblemEvents } from './problem.events';
import { ProblemsRepository } from './problems.repository';
import { ProblemsController } from './problems.controller';
import { ProblemsService } from './problems.service';
import { RevisionsRepository } from './revisions.repository';

const queriers = [
  ProblemTypesQuerier,
  ProblemGroupsQuerier,
  LicensesQuerier,
  LanguagesQuerier,
];
const repositories = [ProblemsRepository, RevisionsRepository];

@Module({
  imports: [AuthModule],
  controllers: [ProblemsController, ProblemEditingController],
  providers: [
    ...queriers,
    ...repositories,
    ProblemsService,
    ProblemEditingService,
    ProblemEvents,
  ],
  exports: [...queriers, ...repositories, ProblemEvents],
})
export class ProblemsApiModule {}
