import { Module } from '@nestjs/common';
import { QuotaService } from './quota.service';

/** Only global modules (database, settings, Redis) underneath, so problems and contests can import it without closing a cycle. */
@Module({ providers: [QuotaService], exports: [QuotaService] })
export class OrganizationQuotaModule {}
