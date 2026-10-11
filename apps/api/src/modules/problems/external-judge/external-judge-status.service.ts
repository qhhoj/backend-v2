import { Injectable } from '@nestjs/common';
import { ExternalJudgeClient } from '@libs/judging';
import { ExternalJudgeStatusResponse } from './dto/external-judge.response';

/** A remote check at most this often per process. */
export const STATUS_CACHE_MS = 60_000;

/** The last answer of the external judge's OJ list, shared by every request of this process. */
@Injectable()
export class ExternalJudgeStatusService {
  private cached: {
    until: number;
    status: ExternalJudgeStatusResponse;
  } | null = null;
  private inFlight: Promise<ExternalJudgeStatusResponse> | null = null;

  constructor(private readonly client: ExternalJudgeClient) {}

  /** Never the URL or the token. A failed check is cached too (unreachable, no OJs), so a down service is not hammered. */
  status(now = Date.now()): Promise<ExternalJudgeStatusResponse> {
    if (!this.client.isConfigured()) {
      this.cached = null;
      return Promise.resolve({
        enabled: false,
        reachable: null,
        checkedAt: null,
        ojs: [],
      });
    }
    if (this.cached && this.cached.until > now)
      return Promise.resolve(this.cached.status);
    this.inFlight ??= this.check(now).finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async check(now: number): Promise<ExternalJudgeStatusResponse> {
    const checkedAt = new Date(now).toISOString();
    const status = await this.client.ojs().then(
      (ojs) => ({
        enabled: true,
        reachable: true,
        checkedAt,
        ojs: ojs.map(({ oj }) => oj),
      }),
      () => ({ enabled: true, reachable: false, checkedAt, ojs: [] }),
    );
    this.cached = { until: now + STATUS_CACHE_MS, status };
    return status;
  }
}
