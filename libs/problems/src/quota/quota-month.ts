import { monthKeyIn } from '@libs/common';
import type { SettingsService } from '@libs/settings';

/** The quota month of `now`: `YYYY-MM` in the site time zone. The one rule for charging judging time and for reading every monthly meter. */
export const quotaMonthOf = (settings: SettingsService, now: Date): string =>
  monthKeyIn(settings.get('site.timeZone'), now);
