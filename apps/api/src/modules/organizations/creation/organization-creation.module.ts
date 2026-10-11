import { Module } from '@nestjs/common';
import { OrganizationCreationRights } from './organization-creation-rights.service';

/** Only global modules (database) underneath, so auth, problems and contests can import it without closing a cycle. */
@Module({
  providers: [OrganizationCreationRights],
  exports: [OrganizationCreationRights],
})
export class OrganizationCreationModule {}
