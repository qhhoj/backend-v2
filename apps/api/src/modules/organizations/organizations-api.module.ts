import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AuthModule } from '@libs/auth';
import { RateLimitService } from '@libs/common';
import {
  NotificationsModule,
  ORGANIZATION_POINTS_QUEUE,
} from '@libs/community';
import { OrganizationEditingController } from './editing/organization-editing.controller';
import { OrganizationEditingService } from './editing/organization-editing.service';
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

@Module({
  imports: [
    AuthModule,
    NotificationsModule,
    BullModule.registerQueue({ name: ORGANIZATION_POINTS_QUEUE }),
  ],
  controllers: [
    OrganizationsController,
    OrganizationEditingController,
    MembershipController,
    OrganizationRequestsController,
    OrganizationRequestQueueController,
  ],
  providers: [
    OrganizationsRepository,
    OrganizationRequestsRepository,
    OrganizationMembersRepository,
    OrganizationPointsService,
    OrganizationsService,
    OrganizationEditingService,
    MembershipService,
    OrganizationRequestsService,
    OrganizationRequestQueueService,
    RateLimitService,
  ],
  exports: [
    OrganizationsRepository,
    OrganizationRequestsRepository,
    OrganizationMembersRepository,
    OrganizationPointsService,
    OrganizationsService,
  ],
})
export class OrganizationsApiModule {}
