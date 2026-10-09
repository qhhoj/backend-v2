import { Module } from '@nestjs/common';
import { NotificationsModule } from '@libs/community';
import { QuotaWarningNotifier } from './quota-warning.notifier';
import { QuotaService } from './quota.service';

/** Only global modules (database, settings, Redis) and the notifications module underneath, so problems and contests can import it without closing a cycle. */
@Module({
  imports: [NotificationsModule],
  providers: [QuotaService, QuotaWarningNotifier],
  exports: [QuotaService],
})
export class OrganizationQuotaModule {}
