import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AuthModule } from '@libs/auth';
import { RateLimitService } from '@libs/common';
import {
  NotificationsModule,
  ORGANIZATION_POINTS_QUEUE,
} from '@libs/community';
import { ProblemsApiModule } from '../problems/problems-api.module';
import { SubmissionsApiModule } from '../submissions/submissions-api.module';
import { OrganizationEditingController } from './editing/organization-editing.controller';
import { OrganizationEditingService } from './editing/organization-editing.service';
import { OrganizationDeletionService } from './editing/organization-deletion.service';
import { OrganizationUnlinkRepository } from './editing/organization-unlink.repository';
import { OrganizationRevisionsService } from './editing/organization-revisions.service';
import { OrganizationToolsService } from './editing/organization-tools.service';
import { OrganizationRequestQueueController } from './requests/organization-request-queue.controller';
import { OrganizationRequestQueueService } from './requests/organization-request-queue.service';
import { OrganizationRequestsController } from './requests/organization-requests.controller';
import { OrganizationRequestsService } from './requests/organization-requests.service';
import { MembershipController } from './membership/membership.controller';
import { MembershipService } from './membership/membership.service';
import { OrganizationMembersRepository } from './core/organization-members.repository';
import { OrganizationRequestsRepository } from './core/organization-requests.repository';
import { OrganizationPointsService } from './core/organization-points.service';
import { OrganizationsController } from './core/organizations.controller';
import { OrganizationsRepository } from './core/organizations.repository';
import { OrganizationsService } from './core/organizations.service';
import { OrganizationQuotaModule } from './quota/organization-quota.module';
import {
  ORGANIZATION_PROBLEM_CONTROLLERS,
  ORGANIZATION_PROBLEM_PROVIDERS,
} from './problems/wiring';
import {
  PROBLEM_TAG_CONTROLLERS,
  PROBLEM_TAG_PROVIDERS,
} from './problem-tags/wiring';
import {
  ORGANIZATION_SUBMISSION_CONTROLLERS,
  ORGANIZATION_SUBMISSION_PROVIDERS,
} from './submissions/wiring';
import {
  ORGANIZATION_USAGE_CONTROLLERS,
  ORGANIZATION_USAGE_PROVIDERS,
} from './usage/wiring';

@Module({
  imports: [
    AuthModule,
    NotificationsModule,
    ProblemsApiModule,
    SubmissionsApiModule,
    OrganizationQuotaModule,
    BullModule.registerQueue({ name: ORGANIZATION_POINTS_QUEUE }),
  ],
  controllers: [
    OrganizationsController,
    OrganizationEditingController,
    MembershipController,
    OrganizationRequestsController,
    OrganizationRequestQueueController,
    ...PROBLEM_TAG_CONTROLLERS,
    ...ORGANIZATION_PROBLEM_CONTROLLERS,
    ...ORGANIZATION_USAGE_CONTROLLERS,
    ...ORGANIZATION_SUBMISSION_CONTROLLERS,
  ],
  providers: [
    OrganizationsRepository,
    OrganizationRequestsRepository,
    OrganizationMembersRepository,
    OrganizationPointsService,
    OrganizationsService,
    OrganizationEditingService,
    OrganizationDeletionService,
    OrganizationUnlinkRepository,
    OrganizationRevisionsService,
    OrganizationToolsService,
    MembershipService,
    OrganizationRequestsService,
    OrganizationRequestQueueService,
    RateLimitService,
    ...PROBLEM_TAG_PROVIDERS,
    ...ORGANIZATION_PROBLEM_PROVIDERS,
    ...ORGANIZATION_USAGE_PROVIDERS,
    ...ORGANIZATION_SUBMISSION_PROVIDERS,
  ],
  exports: [
    OrganizationsRepository,
    OrganizationRequestsRepository,
    OrganizationMembersRepository,
    OrganizationPointsService,
    OrganizationsService,
    OrganizationQuotaModule,
  ],
})
export class OrganizationsApiModule {}
