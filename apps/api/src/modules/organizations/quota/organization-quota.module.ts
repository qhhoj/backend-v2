import { Module } from '@nestjs/common';
import { NotificationsModule } from '@libs/community';
import { QuotaLedgerModule } from '@libs/problems';
import { QuotaWarningNotifier } from './quota-warning.notifier';
import { QuotaService } from './quota.service';

/** Only global modules (database, settings, Redis), the shared ledger and the notifications module underneath, so problems and contests can import it without closing a cycle. */
@Module({
  imports: [NotificationsModule, QuotaLedgerModule],
  providers: [QuotaService, QuotaWarningNotifier],
  exports: [QuotaService, QuotaLedgerModule],
})
export class OrganizationQuotaModule {}
