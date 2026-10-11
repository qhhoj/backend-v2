import { BullModule } from '@nestjs/bullmq';
import { forwardRef, Module } from '@nestjs/common';
import { AuthModule } from '@libs/auth';
import { RateLimitService } from '@libs/common';
import { ExternalJudgeApiModule, PROBLEM_RESCORE_QUEUE } from '@libs/judging';
import {
  PACKAGE_QUEUE,
  PolygonApiModule,
  PDF_QUEUE,
  POLYGON_QUEUE,
  PROBLEM_PURGE_QUEUE,
  PROBLEM_SOLVERS_QUEUE,
} from '@libs/problems';
import { ContestAccessModule } from '../contests/core/contest-access.module';
import { ContributionsModule } from '../contributions/contributions.module';
import { OrganizationCreationModule } from '../organizations/creation/organization-creation.module';
import { OrganizationQuotaModule } from '../organizations/quota/organization-quota.module';
import { DiscordModule } from '../discord/discord.module';
import { LanguagesAdminController } from './catalog/languages-admin.controller';
import { LanguagesAdminService } from './catalog/languages-admin.service';
import { LanguageUsageRepository } from './catalog/language-usage.repository';
import { LanguagesQuerier } from './catalog/languages.querier';
import { LicensesAdminController } from './catalog/licenses-admin.controller';
import { LicensesAdminService } from './catalog/licenses-admin.service';
import { ProblemGroupsAdminController } from './catalog/problem-groups-admin.controller';
import { ProblemTypesAdminController } from './catalog/problem-types-admin.controller';
import {
  ProblemGroupsAdminService,
  ProblemTypesAdminService,
} from './catalog/problem-taxa-admin.service';
import { ProblemBulkVisibilityController } from './bulk/problem-bulk-visibility.controller';
import { ProblemBulkVisibilityService } from './bulk/problem-bulk-visibility.service';
import { LicensesQuerier } from './catalog/licenses.querier';
import { ProblemGroupsQuerier } from './catalog/problem-groups.querier';
import { ProblemTypesQuerier } from './catalog/problem-types.querier';
import { ProblemDataController } from './data/problem-data.controller';
import { ProblemDataLifecycleService } from './data/problem-data-lifecycle.service';
import { ProblemDataService } from './data/problem-data.service';
import { ProblemDataStore } from './data/problem-data.store';
import { ProblemDataUploadService } from './data/problem-data-upload.service';
import { OrganizationProblemCreationController } from './editing/organization-problem-creation.controller';
import { OrganizationProblemRules } from './editing/organization-problem-rules.service';
import { ProblemEditingController } from './editing/problem-editing.controller';
import { ProblemEditingService } from './editing/problem-editing.service';
import { ProblemEditPolicyService } from './editing/problem-edit-policy.service';
import { ProblemCloneService } from './editing/problem-clone.service';
import { ProblemStatementEditingService } from './editing/problem-statement-editing.service';
import { ProblemImportsController } from './imports/problem-imports.controller';
import { ProblemImportsService } from './imports/problem-imports.service';
import { ProblemLifecycleController } from './lifecycle/problem-lifecycle.controller';
import { ProblemLifecycleService } from './lifecycle/problem-lifecycle.service';
import { ProblemPackageController } from './package/problem-package.controller';
import { ProblemPackageService } from './package/problem-package.service';
import { ExternalJudgeConnectionController } from './external-judge/external-judge-connection.controller';
import { ExternalJudgeLookupService } from './external-judge/external-judge-lookup.service';
import { ExternalJudgeStatusController } from './external-judge/external-judge-status.controller';
import { ExternalJudgeStatusService } from './external-judge/external-judge-status.service';
import { ProblemExternalJudgeController } from './external-judge/problem-external-judge.controller';
import { ProblemExternalJudgeService } from './external-judge/problem-external-judge.service';
import { PolygonLinkResolver } from './polygon/polygon-link-resolver.service';
import { PolygonConnectionController } from './polygon/polygon-connection.controller';
import { PolygonController } from './polygon/polygon.controller';
import { PolygonLinkImportService } from './polygon/polygon-link-import.service';
import { PolygonLinkService } from './polygon/polygon-link.service';
import { PolygonLinksRepository } from './polygon/polygon-links.repository';
import { PolygonSyncHistoryService } from './polygon/polygon-sync-history.service';
import { PolygonSyncRunsRepository } from './polygon/polygon-sync-runs.repository';
import { ProblemPolygonLinkController } from './polygon/problem-polygon-link.controller';
import { ProblemPdfController } from './pdf/problem-pdf.controller';
import { ProblemPdfService } from './pdf/problem-pdf.service';
import { ProblemStorageQuota } from './quota/problem-storage-quota.service';
import { ProblemUploadsController } from './uploads/problem-uploads.controller';
import { ProblemUploadsService } from './uploads/problem-uploads.service';
import { ProblemEvents } from './core/problem.events';
import { ProblemRescoreEnqueuerService } from './core/problem-rescore.service';
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
    DiscordModule,
    OrganizationQuotaModule,
    OrganizationCreationModule,
    AuthModule,
    PolygonApiModule,
    ExternalJudgeApiModule,
    forwardRef(() => ContributionsModule),
    BullModule.registerQueue(
      { name: PDF_QUEUE },
      { name: POLYGON_QUEUE },
      { name: PROBLEM_RESCORE_QUEUE },
      { name: PACKAGE_QUEUE },
      { name: PROBLEM_PURGE_QUEUE },
      { name: PROBLEM_SOLVERS_QUEUE },
    ),
  ],
  controllers: [
    ProblemImportsController,
    ProblemsController,
    LanguagesAdminController,
    ProblemTypesAdminController,
    ProblemGroupsAdminController,
    LicensesAdminController,
    ProblemBulkVisibilityController,
    ProblemEditingController,
    OrganizationProblemCreationController,
    ProblemUploadsController,
    ProblemDataController,
    ProblemPdfController,
    ProblemLifecycleController,
    ProblemPackageController,
    PolygonController,
    PolygonConnectionController,
    ProblemPolygonLinkController,
    ExternalJudgeConnectionController,
    ExternalJudgeStatusController,
    ProblemExternalJudgeController,
  ],
  providers: [
    ...queriers,
    ...repositories,
    ProblemsService,
    LanguagesAdminService,
    LanguageUsageRepository,
    ProblemTypesAdminService,
    ProblemGroupsAdminService,
    LicensesAdminService,
    ProblemBulkVisibilityService,
    ProblemEditPolicyService,
    ProblemEditingService,
    OrganizationProblemRules,
    ProblemStatementEditingService,
    ProblemCloneService,
    ProblemUploadsService,
    ProblemDataStore,
    ProblemDataService,
    ProblemDataUploadService,
    ProblemStorageQuota,
    ProblemDataLifecycleService,
    ProblemImportsService,
    PolygonLinkResolver,
    PolygonLinkImportService,
    PolygonLinkService,
    PolygonLinksRepository,
    PolygonSyncRunsRepository,
    PolygonSyncHistoryService,
    ExternalJudgeStatusService,
    ExternalJudgeLookupService,
    ProblemExternalJudgeService,
    ProblemPdfService,
    ProblemLifecycleService,
    ProblemPackageService,
    ProblemRescoreEnqueuerService,
    ProblemEvents,
    RateLimitService,
  ],
  exports: [
    ...queriers,
    ...repositories,
    ProblemsService,
    ProblemEditingService,
    ProblemEvents,
  ],
})
export class ProblemsApiModule {}
