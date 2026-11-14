import { Module } from '@nestjs/common';
import { AuthModule } from '@libs/auth';
import { RateLimitService } from '@libs/common';
import { ContestAccessModule } from '../contests/core/contest-access.module';
import { ProblemsApiModule } from '../problems/problems-api.module';
import { SubmissionsApiModule } from '../submissions/submissions-api.module';
import { ShareAccessService } from './core/share-access.service';
import { ShareWriterService } from './core/share-writer.service';
import { SharesRepository } from './core/shares.repository';
import { ShareCreateController } from './create/share-create.controller';
import { ShareCreateService } from './create/share-create.service';
import { ShareGuardService } from './guard/share-guard.service';
import { ShareModerationController } from './moderation/share-moderation.controller';
import { ShareModerationService } from './moderation/share-moderation.service';
import { MySharesController } from './owning/my-shares.controller';
import { MySharesService } from './owning/my-shares.service';
import { ShareReadController } from './reading/share-read.controller';
import { ShareReadService } from './reading/share-read.service';
import { ShareReportsController } from './reports/share-reports.controller';
import { ShareReportsRepository } from './reports/share-reports.repository';
import { ShareReportsService } from './reports/share-reports.service';

/** Share links `/c/<code>`: frozen submission copies and pastes. */
@Module({
  imports: [
    AuthModule,
    ContestAccessModule,
    ProblemsApiModule,
    SubmissionsApiModule,
  ],
  controllers: [
    ShareCreateController,
    ShareReadController,
    MySharesController,
    ShareModerationController,
    ShareReportsController,
  ],
  providers: [
    RateLimitService,
    SharesRepository,
    ShareAccessService,
    ShareWriterService,
    ShareGuardService,
    ShareCreateService,
    ShareReadService,
    MySharesService,
    ShareModerationService,
    ShareReportsRepository,
    ShareReportsService,
  ],
})
export class SharesApiModule {}
