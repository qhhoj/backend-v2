import { status } from '@grpc/grpc-js';
import { EventEmitter } from 'node:events';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Env } from '@libs/common';
import { newId } from '@libs/database';
import type { Chunk, FetchSourceRequest } from '@libs/judge-proto';
import type { SubmissionsRepository } from '../submissions/submissions.repository';
import { SourceFetch } from './source-fetch';
import type { SourceCall, SourceHolder } from './source-fetch';

class FakeSourceCall extends EventEmitter {
  readonly chunks: Chunk[] = [];
  readonly statuses: Array<{ code: status }> = [];
  ended = false;
  cancelled = false;
  constructor(readonly request: FetchSourceRequest) {
    super();
  }
  write(chunk: Chunk): boolean {
    this.chunks.push(chunk);
    return true;
  }
  end(): void {
    this.ended = true;
  }
  /** grpc-js turns an emitted error into the call's status; recorded here. */
  override emit(event: string | symbol, ...args: unknown[]): boolean {
    if (event !== 'error') return super.emit(event, ...args);
    this.statuses.push(args[0] as { code: status });
    return true;
  }
}

describe('SourceFetch', () => {
  const mediaRoot = mkdtempSync(join(tmpdir(), 'qhhoj-source-fetch-'));
  const directory = join(mediaRoot, 'submission_file', 'sum', 'u1');
  const sources = new Map<string, string>();
  const fetcher = new SourceFetch(
    { mediaRoot, mediaUrl: '/media' } as Env,
    {
      sourceOf: (id: string) => Promise.resolve(sources.get(id) ?? null),
    } as unknown as SubmissionsRepository,
  );
  const held = (submissionId: string, generation = 1): SourceHolder => ({
    id: 'session-1',
    inFlight: new Map([[submissionId, generation]]),
  });
  const fetch = async (
    request: FetchSourceRequest,
    holder: SourceHolder | undefined,
  ) => {
    const call = new FakeSourceCall(request);
    await fetcher.serve(call as unknown as SourceCall, holder);
    return call;
  };
  beforeAll(() => {
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'big.zip'), Buffer.alloc(2_500_000, 7));
    symlinkSync('/etc/passwd', join(directory, 'link.zip'));
    symlinkSync('/etc', join(mediaRoot, 'submission_file', 'outside'));
  });
  afterAll(() => rmSync(mediaRoot, { recursive: true, force: true }));

  it('streams a held run’s file in chunks of at most 1 MiB', async () => {
    const id = newId();
    sources.set(id, '/media/submission_file/sum/u1/big.zip');
    const call = await fetch(
      { ref: { submissionId: id, generation: 1 }, sessionId: 'session-1' },
      held(id),
    );
    expect(call.statuses).toEqual([]);
    expect(call.ended).toBe(true);
    expect(call.chunks.map((chunk) => chunk.data.length)).toEqual([
      1048576, 1048576, 402848,
    ]);
  });

  it('refuses a run the session does not hold: no session, another generation, another session id, an unknown ref', async () => {
    const id = newId();
    sources.set(id, '/media/submission_file/sum/u1/big.zip');
    const ref = { submissionId: id, generation: 1 };
    for (const [request, holder] of [
      [{ ref, sessionId: 'session-1' }, undefined],
      [{ ref: { ...ref, generation: 2 }, sessionId: 'session-1' }, held(id)],
      [{ ref, sessionId: 'session-9' }, held(id)],
      [{ ref, sessionId: '' }, held(id)],
      [{ ref: undefined, sessionId: 'session-1' }, held(id)],
      [
        { ref: { ...ref, submissionId: newId() }, sessionId: 'session-1' },
        held(id),
      ],
    ] as const) {
      const call = await fetch(request, holder);
      expect(call.statuses).toEqual([
        expect.objectContaining({ code: status.PERMISSION_DENIED }),
      ]);
      expect(call.chunks).toEqual([]);
    }
  });

  it('answers NOT_FOUND for a missing file, a symlink, a symlinked parent directory and a URL outside submission_file', async () => {
    for (const url of [
      '/media/submission_file/sum/u1/gone.zip',
      '/media/submission_file/sum/u1/link.zip',
      '/media/submission_file/outside/passwd',
      '/submission_file/sum/u1/big.zip',
    ]) {
      const id = newId();
      sources.set(id, url);
      const call = await fetch(
        { ref: { submissionId: id, generation: 1 }, sessionId: 'session-1' },
        held(id),
      );
      expect(call.statuses).toEqual([
        expect.objectContaining({ code: status.NOT_FOUND }),
      ]);
    }
  });
});
