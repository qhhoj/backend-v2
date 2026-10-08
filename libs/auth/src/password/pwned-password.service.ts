import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ENV, type Env } from '@libs/common';

@Injectable()
export class PwnedPasswordService {
  private readonly logger = new Logger(PwnedPasswordService.name);

  constructor(@Inject(ENV) private readonly env: Env) {}

  async isPwned(password: string): Promise<boolean> {
    if (!this.env.pwnedApiUrl) return false;
    const hash = createHash('sha1')
      .update(password)
      .digest('hex')
      .toUpperCase();
    try {
      const response = await fetch(
        `${this.env.pwnedApiUrl.replace(/\/+$/, '')}/range/${hash.slice(0, 5)}`,
        { signal: AbortSignal.timeout(3000), redirect: 'error' },
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
