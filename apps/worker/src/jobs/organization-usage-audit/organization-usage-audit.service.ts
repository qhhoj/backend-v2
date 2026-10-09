import { Injectable, Logger } from '@nestjs/common';
import { monthKeyIn } from '@libs/common';
import { SettingsService } from '@libs/settings';
import { OrganizationUsageAuditRepository } from './organization-usage-audit.repository';
import type { MonthTotal } from './organization-usage-audit.repository';

const DAY_MS = 86_400_000;
const keyOf = ({ organization, month }: MonthTotal) =>
  `${organization}|${month}`;
const byKey = (rows: MonthTotal[]) =>
  new Map(rows.map((row) => [keyOf(row), row]));

/** Compares the credit counters with the append-only ledger for the current and previous month. Reports, never repairs: a drift is a bug to find, not to hide. */
@Injectable()
export class OrganizationUsageAuditService {
  private readonly logger = new Logger(OrganizationUsageAuditService.name);

  constructor(
    private readonly settings: SettingsService,
    private readonly repository: OrganizationUsageAuditRepository,
  ) {}

  async audit(now = new Date()): Promise<{ checked: number; drifted: number }> {
    const months = this.recentMonths(now);
    const [ledger, counters] = await Promise.all([
      this.repository.ledgerTotals(months),
      this.repository.counterTotals(months),
    ]);
    const ledgerBy = byKey(ledger);
    const counterBy = byKey(counters);
    const keys = new Set([...ledgerBy.keys(), ...counterBy.keys()]);
    let drifted = 0;
    for (const key of keys) {
      const row = (ledgerBy.get(key) ?? counterBy.get(key))!;
      const drift = {
        organization: row.organization,
        month: row.month,
        ledger: ledgerBy.get(key)?.total ?? 0,
        counter: counterBy.get(key)?.total ?? 0,
      };
      if (drift.ledger === drift.counter) continue;
      drifted += 1;
      this.logger.warn(
        JSON.stringify({ event: 'organization.usage.drift', ...drift }),
      );
    }
    return { checked: keys.size, drifted };
  }

  /** The month containing `now` and the one before it, in the site time zone: stepping back by the day of the month plus one day always lands in the previous month. */
  private recentMonths(now: Date): string[] {
    const zone = this.settings.get('site.timeZone');
    const dayOfMonth = Number(
      new Intl.DateTimeFormat('en-US', {
        timeZone: zone,
        day: 'numeric',
      }).format(now),
    );
    const inPreviousMonth = new Date(now.getTime() - (dayOfMonth + 1) * DAY_MS);
    return [monthKeyIn(zone, now), monthKeyIn(zone, inPreviousMonth)];
  }
}
