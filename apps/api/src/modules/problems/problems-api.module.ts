import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AuthModule } from '@libs/auth';
import { RateLimitService } from '@libs/common';
import { PROBLEM_RESCORE_QUEUE } from '@libs/judging';
import { PDF_QUEUE, POLYGON_QUEUE } from '@libs/problems';
import { ContestAccessModule } from '../contests/core/contest-access.module';
import { LanguagesQuerier } from './catalog/languages.querier';
import { LicensesQuerier } from './catalog/licenses.querier';
import { ProblemGroupsQuerier } from './catalog/problem-groups.querier';
import { ProblemTypesQuerier } from './catalog/problem-types.querier';
import { ProblemDataController } from './data/problem-data.controller';
import { ProblemDataLifecycleService } from './data/problem-data-lifecycle.service';
import { ProblemDataService } from './data/problem-data.service';
import { ProblemDataStore } from './data/problem-data.store';
import { ProblemDataUploadService } from './data/problem-data-upload.service';
import { ProblemEditingController } from './editing/problem-editing.controller';
import { ProblemEditingService } from './editing/problem-editing.service';
import { ProblemEditPolicyService } from './editing/problem-edit-policy.service';
import { ProblemCloneService } from './editing/problem-clone.service';
import { ProblemStatementEditingService } from './editing/problem-statement-editing.service';
import { ProblemImportsController } from './imports/problem-imports.controller';
import { ProblemImportsService } from './imports/problem-imports.service';
import { ProblemPdfController } from './pdf/problem-pdf.controller';
import { ProblemPdfService } from './pdf/problem-pdf.service';
import { ProblemUploadsController } from './uploads/problem-uploads.controller';
import { ProblemUploadsService } from './uploads/problem-uploads.service';
import { ProblemEvents } from './core/problem.events';
import { ProblemRescoreEnqueuer } from './core/problem-rescore.service';
import { ProblemsRepository } from './core/problems.repository';
import { ProblemsController } from './core/problems.controller';
import { ProblemsService } from './core/problems.service';
import { RevisionsRepository } from './core/revisions.repository';
import { ViewerStatusRepository } from './core/viewer-status.repository';

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
    ProblemEditPolicyService,
    ProblemEditingService,
    ProblemStatementEditingService,
    ProblemCloneService,
    ProblemUploadsService,
    ProblemDataStore,
    ProblemDataService,
    ProblemDataUploadService,
    ProblemDataLifecycleService,
    ProblemImportsService,
    ProblemPdfService,
    ProblemRescoreEnqueuer,
    ProblemEvents,
    RateLimitService,
  ],
  exports: [...queriers, ...repositories, ProblemsService, ProblemEvents],
})
export class ProblemsApiModule {}
