import { Module } from '@nestjs/common';
import { AuthModule } from '@libs/auth';
import { RateLimitService } from '@libs/common';
import { LanguagesQuerier } from './languages.querier';
import { LicensesQuerier } from './licenses.querier';
import { ProblemGroupsQuerier } from './problem-groups.querier';
import { ProblemTypesQuerier } from './problem-types.querier';
import { ProblemDataController } from './problem-data.controller';
import { ProblemDataService } from './problem-data.service';
import { ProblemEditingController } from './problem-editing.controller';
import { ProblemEditingService } from './problem-editing.service';
import { ProblemUploadsController } from './problem-uploads.controller';
import { ProblemUploadsService } from './problem-uploads.service';
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
  controllers: [
    ProblemsController,
    ProblemEditingController,
    ProblemUploadsController,
    ProblemDataController,
  ],
  providers: [
    ...queriers,
    ...repositories,
    ProblemsService,
    ProblemEditingService,
    ProblemUploadsService,
    ProblemDataService,
    ProblemEvents,
    RateLimitService,
  ],
  exports: [...queriers, ...repositories, ProblemsService, ProblemEvents],
})
export class ProblemsApiModule {}
