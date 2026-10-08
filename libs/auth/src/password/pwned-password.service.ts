import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { SettingsService } from '@libs/settings';

const PWNED_LOOKUP_TIMEOUT_MS = 3000;

@Injectable()
export class PwnedPasswordService {
  private readonly logger = new Logger(PwnedPasswordService.name);

  constructor(
    @Inject(SettingsService)
    private readonly settings: Pick<SettingsService, 'get'>,
  ) {}

  async isPwned(password: string): Promise<boolean> {
    const baseUrl = this.settings.get('auth.pwnedApiUrl');
    if (!baseUrl) return false;
    const hash = createHash('sha1')
      .update(password)
      .digest('hex')
      .toUpperCase();
    try {
      const response = await fetch(
        `${baseUrl.replace(/\/+$/, '')}/range/${hash.slice(0, 5)}`,
        {
          signal: AbortSignal.timeout(PWNED_LOOKUP_TIMEOUT_MS),
          redirect: 'error',
        },
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return (await response.text())
        .split('\n')
        .some((line) => line.split(':')[0].trim() === hash.slice(5));
    } catch (error) {
      this.logger.warn(
        `Pwned password check skipped: ${(error as Error).message}`,
      );
      return false;
    }
  }
}
