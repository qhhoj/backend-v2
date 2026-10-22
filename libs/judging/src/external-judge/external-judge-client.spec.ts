import { fakeSettings } from '@libs/settings/testing';
import { ExternalJudgeClient } from './external-judge-client';
import type { ExternalJudgeFetch } from './external-judge-client';
import { ExternalJudgeError } from './external-judge.error';

const TOKEN = 'secret-token-123';
const CONFIGURED = {
  'externalJudge.baseUrl': 'https://pcd.test/base',
  'externalJudge.apiToken': TOKEN,
};

interface Call {
  url: string;
  init: RequestInit;
}

/** Answers every call with `respond`, recording what was sent. */
function fakeFetch(respond: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchFn = (async (url: URL | string, init: RequestInit) => {
    const call = { url: String(url), init };
    calls.push(call);
    return respond(call);
  }) as ExternalJudgeFetch;
  return { calls, fetchFn };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const errorOf = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error: ExternalJudgeError) => error,
  );

describe('ExternalJudgeClient', () => {
  it('makes no call while the base URL or the token is unset', async () => {
    const { calls, fetchFn } = fakeFetch(() => json({}));
    const client = new ExternalJudgeClient(
      fakeSettings({ ...CONFIGURED, 'externalJudge.apiToken': '' }),
      fetchFn,
    );
    expect(client.isConfigured()).toBe(false);
    expect((await errorOf(client.ojs()))?.code).toBe(
      'external_judge_not_configured',
    );
    expect(calls).toEqual([]);
  });

  it('sends the token only in the Authorization header and refuses redirects', async () => {
    const { calls, fetchFn } = fakeFetch(() =>
      json({ data: { submissionId: 'r-1', systemStatus: 'queued' } }),
    );
    const client = new ExternalJudgeClient(fakeSettings(CONFIGURED), fetchFn);
    const run = await client.submit({
      oj: 'CodeForces',
      problemId: '490B',
      language: '89',
      source: 'int main(){}',
    });
    expect(run).toMatchObject({ remoteId: 'r-1', systemStatus: 'queued' });
    const [{ url, init }] = calls;
    expect(url).toBe('https://pcd.test/base/api/v1/submissions');
    expect(init.redirect).toBe('error');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${TOKEN}`,
    );
    expect(JSON.parse(init.body as string)).toEqual({
      oj: 'CodeForces',
      problemId: '490B',
      language: '89',
      source: 'int main(){}',
      open: true,
    });
    expect(url).not.toContain(TOKEN);
  });

  it('escapes path segments', async () => {
    const { calls, fetchFn } = fakeFetch(() =>
      json({ title: 'T', languages: [{ id: '1', name: 'C++' }] }),
    );
    const client = new ExternalJudgeClient(fakeSettings(CONFIGURED), fetchFn);
    await client.problem('OJ UZ', 'a/../b');
    expect(calls[0].url).toBe(
      'https://pcd.test/base/api/v1/problems/OJ%20UZ/a%2F..%2Fb',
    );
  });

  it.each([
    ['..', 'me'],
    ['CodeForces', '..'],
    ['.', '490B'],
  ])(
    'refuses the dot segment in %s/%s without calling the external judge',
    async (oj, problemId) => {
      const { calls, fetchFn } = fakeFetch(() => json({ title: 'T' }));
      const client = new ExternalJudgeClient(fakeSettings(CONFIGURED), fetchFn);
      expect((await errorOf(client.problem(oj, problemId)))?.code).toBe(
        'external_judge_not_found',
      );
      expect((await errorOf(client.status('..')))?.code).toBe(
        'external_judge_not_found',
      );
      expect(calls).toEqual([]);
    },
  );

  it.each([
    [401, 'external_judge_unauthorized', false],
    [403, 'external_judge_unauthorized', false],
    [404, 'external_judge_not_found', false],
    [400, 'external_judge_rejected', false],
    [429, 'external_judge_unavailable', true],
    [502, 'external_judge_unavailable', true],
  ])(
    'maps HTTP %i to %s (transient: %p) with no token or body in the message',
    async (status, code, transient) => {
      const { fetchFn } = fakeFetch(() =>
        json({ error: `echo ${TOKEN}` }, status),
      );
      const client = new ExternalJudgeClient(fakeSettings(CONFIGURED), fetchFn);
      const error = await errorOf(client.status('r-1'));
      expect(error).toBeInstanceOf(ExternalJudgeError);
      expect(error?.code).toBe(code);
      expect(error?.isTransient).toBe(transient);
      expect(error?.message).not.toContain(TOKEN);
      expect(error?.message).not.toContain('pcd.test');
    },
  );

  it('treats a network failure, a timeout and a non-JSON body as unavailable', async () => {
    const failing = new ExternalJudgeClient(
      fakeSettings(CONFIGURED),
      fakeFetch(() =>
        Promise.reject(new Error(`connect https://pcd.test ${TOKEN}`)),
      ).fetchFn,
    );
    const failure = await errorOf(failing.ojs());
    expect(failure?.code).toBe('external_judge_unavailable');
    expect(failure?.message).not.toContain(TOKEN);
    const garbled = new ExternalJudgeClient(
      fakeSettings(CONFIGURED),
      fakeFetch(() => new Response('<html>', { status: 200 })).fetchFn,
    );
    expect((await errorOf(garbled.ojs()))?.code).toBe(
      'external_judge_unavailable',
    );
  });

  it("falls back to the OJ's languages when the problem lists none", async () => {
    const { fetchFn } = fakeFetch(({ url }) =>
      url.endsWith('/ojs')
        ? json({
            items: [
              {
                oj: 'codeforces',
                languageMap: { 'GNU G++20': '89', 'Python 3': '31' },
              },
            ],
          })
        : json({ title: 'Queue' }),
    );
    const client = new ExternalJudgeClient(fakeSettings(CONFIGURED), fetchFn);
    expect(await client.problem('CodeForces', '490B')).toEqual({
      oj: 'CodeForces',
      problemId: '490B',
      title: 'Queue',
      languages: [
        { id: '89', name: 'GNU G++20' },
        { id: '31', name: 'Python 3' },
      ],
    });
  });

  it('keeps only http(s) remote links', async () => {
    const { fetchFn } = fakeFetch(() =>
      json({ remoteUrl: 'javascript:alert(1)' }),
    );
    const client = new ExternalJudgeClient(fakeSettings(CONFIGURED), fetchFn);
    expect((await client.status('r-1')).remoteUrl).toBeNull();
  });
});
