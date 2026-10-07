import { waitUntil } from '@libs/common/testing';
import {
  startClosingMoss,
  startDripFeedMoss,
  startFakeMoss,
} from '../../../test/fake-moss';
import { MossError, submitToMoss } from './moss-client';
import type { MossFile, MossServer } from './moss-client';

const serverAt = (
  port: number,
  extra: Partial<MossServer> = {},
): MossServer => ({
  host: '127.0.0.1',
  port,
  timeoutMs: 2000,
  batchTimeoutMs: 5000,
  ...extra,
});

/** The error a request must fail with. */
const failureOf = (request: Promise<string>): Promise<Error> =>
  request.then(
    () => {
      throw new Error('the request was expected to fail');
    },
    (error: Error) => error,
  );

describe('submitToMoss', () => {
  const request = (files: MossFile[], language = 'cc') => ({
    userId: 'secret-id',
    language,
    comment: 'round_1 - sum',
    files,
  });

  it('speaks the mosspy protocol and returns the result URL', async () => {
    const moss = await startFakeMoss(
      () => 'http://moss.stanford.edu/results/1/2345',
    );
    try {
      const url = await submitToMoss(
        serverAt(moss.port),
        request([
          { name: 'alice', content: Buffer.from('int main(){}\n') },
          { name: 'bob', content: Buffer.from('ü') },
        ]),
      );
      expect(url).toBe('http://moss.stanford.edu/results/1/2345');
      await waitUntil(() => moss.sessions[0].commands.at(-1) === 'end');
      expect(moss.sessions[0].commands).toEqual([
        'moss secret-id',
        'directory 0',
        'X 0',
        'maxmatches 10',
        'show 100',
        'language cc',
        'query 0 round_1 - sum',
        'end',
      ]);
      expect(moss.sessions[0].files).toEqual([
        { index: 1, language: 'cc', name: 'alice', content: 'int main(){}\n' },
        { index: 2, language: 'cc', name: 'bob', content: 'ü' },
      ]);
    } finally {
      await moss.close();
    }
  });

  it('fails on a refused language, a foreign URL and a silent server, never naming the user id', async () => {
    const refusing = await startFakeMoss(
      () => 'http://moss.stanford.edu/results/1/1',
    );
    const foreign = await startFakeMoss(() => 'javascript:alert(1)');
    const silent = await startFakeMoss(() => null);
    try {
      const errors = await Promise.all([
        failureOf(submitToMoss(serverAt(refusing.port), request([], 'rust'))),
        failureOf(submitToMoss(serverAt(foreign.port), request([]))),
        failureOf(
          submitToMoss(serverAt(silent.port, { timeoutMs: 200 }), request([])),
        ),
      ]);
      for (const error of errors) {
        expect(error).toBeInstanceOf(MossError);
        expect(error.message).not.toContain('secret-id');
      }
      expect(errors[2].message).toMatch(/timed out/);
    } finally {
      await Promise.all([refusing.close(), foreign.close(), silent.close()]);
    }
  });

  it('fails at the batch deadline when the server drips bytes forever', async () => {
    const dripping = await startDripFeedMoss();
    try {
      const started = Date.now();
      const error = await failureOf(
        submitToMoss(
          serverAt(dripping.port, { timeoutMs: 2000, batchTimeoutMs: 300 }),
          request([]),
        ),
      );
      expect(error).toBeInstanceOf(MossError);
      expect(error.message).toMatch(/timed out/);
      // Far below the idle timeout, which the dripping bytes keep resetting.
      expect(Date.now() - started).toBeLessThan(1500);
    } finally {
      await dripping.close();
    }
  });

  it('fails promptly when the server closes cleanly while a large file is uploading', async () => {
    const closing = await startClosingMoss();
    try {
      const started = Date.now();
      const error = await failureOf(
        submitToMoss(
          serverAt(closing.port, { timeoutMs: 5000, batchTimeoutMs: 5000 }),
          request([
            { name: 'big', content: Buffer.alloc(32 * 1024 * 1024, 'a') },
          ]),
        ),
      );
      expect(error).toBeInstanceOf(MossError);
      expect(Date.now() - started).toBeLessThan(2500);
    } finally {
      await closing.close();
    }
  });

  it('fails fast when nothing listens', async () => {
    await expect(submitToMoss(serverAt(1), request([]))).rejects.toThrow(
      MossError,
    );
  });
});
