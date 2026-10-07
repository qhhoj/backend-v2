import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AuthModule } from '@libs/auth';
import { RateLimitService } from '@libs/common';
import { PROBLEM_RESCORE_QUEUE } from '@libs/judging';
import { PDF_QUEUE, POLYGON_QUEUE } from '@libs/problems';
import { ContestAccessModule } from '../contests/contest-access.module';
import { LanguagesQuerier } from './languages.querier';
import { LicensesQuerier } from './licenses.querier';
import { ProblemGroupsQuerier } from './problem-groups.querier';
import { ProblemTypesQuerier } from './problem-types.querier';
import { ProblemDataController } from './problem-data.controller';
import { ProblemDataService } from './problem-data.service';
import { ProblemEditingController } from './problem-editing.controller';
import { ProblemEditingService } from './problem-editing.service';
import { ProblemImportsController } from './problem-imports.controller';
import { ProblemImportsService } from './problem-imports.service';
import { ProblemPdfController } from './problem-pdf.controller';
import { ProblemPdfService } from './problem-pdf.service';
import { ProblemUploadsController } from './problem-uploads.controller';
import { ProblemUploadsService } from './problem-uploads.service';
import { ProblemEvents } from './problem.events';
import { ProblemRescoreEnqueuer } from './problem-rescore.service';
import { ProblemsRepository } from './problems.repository';
import { ProblemsController } from './problems.controller';
import { ProblemsService } from './problems.service';
import { RevisionsRepository } from './revisions.repository';
import { ViewerStatusRepository } from './viewer-status.repository';

const queriers = [
  ProblemTypesQuerier,
  ProblemGroupsQuerier,
  LicensesQuerier,
  LanguagesQuerier,
];
const repositories = [
  ProblemsRepository,
  RevisionsRepository,
  ViewerStatusRepository,
];

@Module({
  imports: [
    ContestAccessModule,
    AuthModule,
    BullModule.registerQueue(
      { name: PDF_QUEUE },
      { name: POLYGON_QUEUE },
      { name: PROBLEM_RESCORE_QUEUE },
    ),
  ],
  controllers: [
    ProblemImportsController,
    ProblemsController,
    ProblemEditingController,
    ProblemUploadsController,
    ProblemDataController,
    ProblemPdfController,
  ],
  providers: [
    ...queriers,
    ...repositories,
    ProblemsService,
    ProblemEditingService,
    ProblemUploadsService,
    ProblemDataService,
    ProblemImportsService,
    ProblemPdfService,
    ProblemRescoreEnqueuer,
    ProblemEvents,
    RateLimitService,
  ],
  exports: [...queriers, ...repositories, ProblemsService, ProblemEvents],
})
export class ProblemsApiModule {}
