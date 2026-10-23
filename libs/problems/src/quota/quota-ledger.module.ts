import { Module } from '@nestjs/common';
import { JudgingCharges } from './judging-charges.service';
import { QuotaLedger } from './quota-ledger.service';

/** Only global modules (database, settings, Redis) underneath: the api's `OrganizationQuotaModule`, the worker's Polygon import and its submission effects (judging charges) import it. */
@Module({
  providers: [QuotaLedger, JudgingCharges],
  exports: [QuotaLedger, JudgingCharges],
})
export class QuotaLedgerModule {}
