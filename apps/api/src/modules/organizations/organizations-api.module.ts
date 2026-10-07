import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AuthModule } from '@libs/auth';
import { ORGANIZATION_POINTS_QUEUE } from '@libs/community';
import { OrganizationEditingController } from './editing/organization-editing.controller';
import { OrganizationEditingService } from './editing/organization-editing.service';
import { MembershipController } from './membership/membership.controller';
import { MembershipService } from './membership/membership.service';
import { OrganizationMembersRepository } from './core/organization-members.repository';
import { OrganizationPointsService } from './core/organization-points.service';
import { OrganizationsController } from './core/organizations.controller';
import { OrganizationsRepository } from './core/organizations.repository';
import { OrganizationsService } from './core/organizations.service';

@Module({
  imports: [
    AuthModule,
    BullModule.registerQueue({ name: ORGANIZATION_POINTS_QUEUE }),
  ],
  controllers: [
    OrganizationsController,
    OrganizationEditingController,
    MembershipController,
  ],
  providers: [
    OrganizationsRepository,
    OrganizationMembersRepository,
    OrganizationPointsService,
    OrganizationsService,
    OrganizationEditingService,
    MembershipService,
  ],
  exports: [
    OrganizationsRepository,
    OrganizationMembersRepository,
    OrganizationPointsService,
    OrganizationsService,
  ],
})
export class OrganizationsApiModule {}
