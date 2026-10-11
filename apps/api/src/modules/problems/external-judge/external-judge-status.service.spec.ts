import { ExternalJudgeError } from '@libs/judging';
import type { ExternalJudgeClient } from '@libs/judging';
import {
  ExternalJudgeStatusService,
  STATUS_CACHE_MS,
} from './external-judge-status.service';

function service(ojs: () => Promise<Array<{ oj: string }>>, configured = true) {
  const client = {
    isConfigured: () => configured,
    ojs: jest.fn(ojs),
  };
  return {
    client,
    statuses: new ExternalJudgeStatusService(
      client as unknown as ExternalJudgeClient,
    ),
  };
}

describe('ExternalJudgeStatusService', () => {
  it('asks the external judge once for requests within a minute, even concurrent ones', async () => {
    const { client, statuses } = service(() =>
      Promise.resolve([{ oj: 'QOJ' }, { oj: 'OJUZ' }]),
    );
    const answers = await Promise.all([
      statuses.status(0),
      statuses.status(0),
      statuses.status(0),
    ]);
    await statuses.status(STATUS_CACHE_MS - 1);
    expect(client.ojs).toHaveBeenCalledTimes(1);
    expect(answers[2]).toEqual({
      enabled: true,
      reachable: true,
      checkedAt: new Date(0).toISOString(),
      ojs: ['QOJ', 'OJUZ'],
    });
  });

  it('asks again after a minute', async () => {
    const { client, statuses } = service(() => Promise.resolve([]));
    await statuses.status(0);
    await statuses.status(STATUS_CACHE_MS);
    expect(client.ojs).toHaveBeenCalledTimes(2);
  });

  it('caches a failure as unreachable with no OJs', async () => {
    const { client, statuses } = service(() =>
      Promise.reject(new ExternalJudgeError('external_judge_unavailable')),
    );
    const first = await statuses.status(0);
    await statuses.status(1000);
    expect(first).toMatchObject({ enabled: true, reachable: false, ojs: [] });
    expect(client.ojs).toHaveBeenCalledTimes(1);
  });

  it('does not call out when not configured', async () => {
    const { client, statuses } = service(() => Promise.resolve([]), false);
    expect(await statuses.status(0)).toEqual({
      enabled: false,
      reachable: null,
      checkedAt: null,
      ojs: [],
    });
    expect(client.ojs).not.toHaveBeenCalled();
  });
});
