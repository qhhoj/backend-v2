import { Module } from '@nestjs/common';
import { QuotaLedger } from './quota-ledger.service';

/** Only global modules (database, settings, Redis) underneath: the api's `OrganizationQuotaModule` and the worker's Polygon import both import it. */
@Module({ providers: [QuotaLedger], exports: [QuotaLedger] })
export class QuotaLedgerModule {}
