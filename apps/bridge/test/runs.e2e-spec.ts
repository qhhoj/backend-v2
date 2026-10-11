import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newId, SUBMISSION_PRIORITY } from '@libs/database';
import { requeueUpdate } from '@libs/judging';
import type { Problem } from '@libs/database';
import { SubmissionsRepository } from '../src/submissions/submissions.repository';
import { seedCatalog, seedProblem, seedSubmission } from './fixtures';
import type { BridgeCatalog } from './fixtures';
import { setupBridgeTest } from './setup';
import type { BridgeTest } from './setup';

const JUDGE = 'judge-01';

describe('Runs (claims with generations, and the lifecycle writes of the new protocol)', () => {
  let bridge: BridgeTest;
  let catalog: BridgeCatalog;
  let repository: SubmissionsRepository;
  let codes = 0;
  const nextCode = () => `run${(codes += 1)}`;
  const stored = async (id: string) =>
    (await bridge.submissions.findById(id).lean())!;
  const queuedRow = async (
    problemFields: Partial<Problem> = {},
    source?: string,
  ) => {
    const problem = await seedProblem(bridge, catalog, {
      code: nextCode(),
      ...problemFields,
    });
    const submission = await seedSubmission(bridge, catalog, {
      problem: problem._id,
      ...(source !== undefined && { source }),
    });
    const [queued] = await repository.loadQueued([submission._id]);
    return { problem, id: submission._id, queued };
  };
  const claimedRun = async () => {
    const { id, queued } = await queuedRow();
    const claim = await repository.claimRun(queued, JUDGE);
    if (!claim || !('request' in claim)) throw new Error('not claimed');
    return { id, ref: claim.request.ref };
  };

  beforeAll(async () => {
    bridge = await setupBridgeTest();
    catalog = await seedCatalog(bridge);
    repository = bridge.module.get(SubmissionsRepository);
  });
  afterAll(async () => {
    rmSync(join(tmpdir(), 'submission_file'), { recursive: true, force: true });
    await bridge.teardown();
  });

  it('claims QU → P with the next generation and builds the Assign from the problem and the source', async () => {
    const { problem, id, queued } = await queuedRow(
      {
        dataVersion: 5,
        partial: true,
        languageLimits: [
          { languageId: catalog.cpp._id, timeLimit: 5, memoryLimit: 65536 },
        ],
      },
      'int main() { puts("ố"); }',
    );
    expect(queued.generation).toBe(0);
    const claim = await repository.claimRun(queued, JUDGE);
    expect(claim && 'request' in claim && claim.request).toEqual({
      ref: { submissionId: id, generation: 1 },
      problemCode: problem.code,
      dataVersion: 5,
      languageKey: 'CPP17',
      source: 'int main() { puts("ố"); }',
      fileOnly: false,
      sourceSize: 27,
      timeLimit: 5,
      memoryLimit: 65536,
      shortCircuit: false,
      pretestsOnly: false,
      inContest: null,
      attemptNo: 1,
      userId: catalog.user._id,
    });
    expect(await stored(id)).toMatchObject({
      status: 'P',
      judgedOn: JUDGE,
      judgeGeneration: 1,
      judgeSeq: 0,
    });
    expect(await repository.claimRun(queued, 'judge-02')).toBeNull();
    expect(
      await repository.releaseRun({ submissionId: id, generation: 1 }, JUDGE),
    ).toBe(true);
    const [again] = await repository.loadQueued([id]);
    expect(again.generation).toBe(1);
    const second = await repository.claimRun(again, 'judge-02');
    expect(second && 'request' in second && second.request.ref).toEqual({
      submissionId: id,
      generation: 2,
    });
  });

  it('keeps the judge pinned at submit across an accept timeout and a resync reset; a judge loss and a rejudge drop it', async () => {
    const problem = await seedProblem(bridge, catalog, { code: nextCode() });
    const pinned = async () =>
      (
        await seedSubmission(bridge, catalog, {
          problem: problem._id,
          pinnedJudge: JUDGE,
        })
      )._id;
    const pinOf = async (id: string) =>
      (await repository.loadQueued([id]))[0]?.judgeName;
    const claimed = async (id: string) => {
      const [queued] = await repository.loadQueued([id]);
      const claim = await repository.claimRun(queued, JUDGE);
      if (!claim || !('request' in claim)) throw new Error('not claimed');
      return claim.request.ref;
    };
    const id = await pinned();
    expect(await pinOf(id)).toBe(JUDGE);
    expect(await repository.releaseRun(await claimed(id), JUDGE)).toBe(true);
    expect(await pinOf(id)).toBe(JUDGE);
    const ref = await claimed(id);
    await repository.resetStrandedRuns([
      { id, judgedOn: JUDGE, generation: ref.generation },
    ]);
    expect(await pinOf(id)).toBe(JUDGE);
    expect(
      await repository.requeueRun(await claimed(id), JUDGE),
    ).not.toBeNull();
    expect(await pinOf(id)).toBeNull();

    const rejudged = await pinned();
    const finalOnly = await pinned();
    await bridge.submissions.updateOne(
      { _id: rejudged },
      requeueUpdate(SUBMISSION_PRIORITY.rejudge),
    );
    await bridge.submissions.updateOne(
      { _id: finalOnly },
      requeueUpdate(SUBMISSION_PRIORITY.batchRejudge, { keepsPin: true }),
    );
    expect([await pinOf(rejudged), await pinOf(finalOnly)]).toEqual([
      null,
      JUDGE,
    ]);
  });

  it("sends a mirror its root's data version", async () => {
    const root = await seedProblem(bridge, catalog, {
      code: nextCode(),
      dataVersion: 9,
    });
    const mirror = await seedProblem(bridge, catalog, {
      code: nextCode(),
      dataVersion: 1,
      mirrorOf: root._id,
      mirrorRoot: root._id,
    });
    const submission = await seedSubmission(bridge, catalog, {
      problem: mirror._id,
    });
    const [queued] = await repository.loadQueued([submission._id]);
    const claim = await repository.claimRun(queued, JUDGE);
    expect(claim && 'request' in claim && claim.request).toMatchObject({
      problemCode: root.code,
      dataVersion: 9,
    });
  });

  it('raises a memory limit under 1 MiB to 1024 KiB, so isolate never gets --cg-mem=0', async () => {
    const { queued } = await queuedRow({ memoryLimit: 0 });
    const claim = await repository.claimRun(queued, JUDGE);
    expect(claim && 'request' in claim && claim.request.memoryLimit).toBe(1024);
    const { queued: overridden } = await queuedRow({
      languageLimits: [
        { languageId: catalog.cpp._id, timeLimit: 1, memoryLimit: 12 },
      ],
    });
    const second = await repository.claimRun(overridden, JUDGE);
    expect(second && 'request' in second && second.request.memoryLimit).toBe(
      1024,
    );
  });

  it('sends a file-only source as its media URL with the file size, and fails the run as IE when the file is gone', async () => {
    const output = await bridge.languages.create({
      key: 'OUTPUT',
      name: 'Output only',
      commonName: 'Output',
      ace: 'text',
      pygments: 'text',
      extension: 'zip',
      fileOnly: true,
      fileSizeLimit: 10,
    });
    const problem = await seedProblem(bridge, catalog, {
      code: nextCode(),
      allowedLanguages: [output._id],
    });
    const directory = join(
      tmpdir(),
      'submission_file',
      problem.code,
      catalog.user._id,
    );
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'a.zip'), Buffer.alloc(2500));
    const url = `/media/submission_file/${problem.code}/${catalog.user._id}`;
    const present = await seedSubmission(bridge, catalog, {
      problem: problem._id,
      language: output._id,
      source: `${url}/a.zip`,
    });
    const missing = await seedSubmission(bridge, catalog, {
      problem: problem._id,
      language: output._id,
      source: `${url}/gone.zip`,
    });
    const [presentQueued, missingQueued] = await repository.loadQueued([
      present._id,
      missing._id,
    ]);
    const claim = await repository.claimRun(presentQueued, JUDGE);
    expect(claim && 'request' in claim && claim.request).toMatchObject({
      fileOnly: true,
      source: `${url}/a.zip`,
      sourceSize: 2500,
    });
    const failed = await repository.claimRun(missingQueued, JUDGE);
    expect(failed && 'failed' in failed && failed.failed.submissionId).toBe(
      missing._id,
    );
    expect(await stored(missing._id)).toMatchObject({
      status: 'IE',
      error: 'Submission data is missing',
    });
  });

  it('releases only an unaccepted run of the same judge and generation', async () => {
    const { id, ref } = await claimedRun();
    expect(await repository.releaseRun({ ...ref, generation: 2 }, JUDGE)).toBe(
      false,
    );
    expect(await repository.releaseRun(ref, 'judge-02')).toBe(false);
    await bridge.submissions.updateOne({ _id: id }, { $set: { judgeSeq: 1 } });
    expect(await repository.releaseRun(ref, JUDGE)).toBe(false);
    await bridge.submissions.updateOne({ _id: id }, { $set: { judgeSeq: 0 } });
    expect(await repository.releaseRun(ref, JUDGE)).toBe(true);
    expect(await stored(id)).toMatchObject({
      status: 'QU',
      judgedOn: null,
      judgeGeneration: 1,
      requeueCount: 0,
    });
  });

  it('requeues a lost run once, keeping the generation and dropping its partial results', async () => {
    const { id, ref } = await claimedRun();
    await bridge.submissions.updateOne(
      { _id: id },
      { $set: { status: 'G', judgeSeq: 4, currentTestcase: 3, batch: true } },
    );
    expect(await repository.requeueRun(ref, JUDGE)).toEqual(
      expect.objectContaining({ submissionId: id }),
    );
    expect(await stored(id)).toMatchObject({
      status: 'QU',
      judgedOn: null,
      judgeGeneration: 1,
      judgeSeq: 0,
      currentTestcase: 0,
      batch: false,
      requeueCount: 1,
    });
    const [queued] = await repository.loadQueued([id]);
    const again = await repository.claimRun(queued, JUDGE);
    const second = again && 'request' in again ? again.request.ref : ref;
    expect(second.generation).toBe(2);
    expect(await repository.requeueRun(second, JUDGE)).toBeNull();
  });

  it('tells a reconnecting judge the seq stored for a run it still holds, and nothing for a run that moved on', async () => {
    const { id, ref } = await claimedRun();
    await bridge.submissions.updateOne(
      { _id: id },
      { $set: { status: 'G', judgeSeq: 3 } },
    );
    expect(await repository.resumableSeq(ref, JUDGE)).toBe(3);
    expect(await repository.resumableSeq(ref, 'judge-02')).toBeNull();
    expect(
      await repository.resumableSeq({ ...ref, generation: 2 }, JUDGE),
    ).toBeNull();
    await bridge.submissions.updateOne({ _id: id }, { $set: { status: 'D' } });
    expect(await repository.resumableSeq(ref, JUDGE)).toBeNull();
    expect(
      await repository.resumableSeq(
        { submissionId: newId(), generation: 1 },
        JUDGE,
      ),
    ).toBeNull();
  });

  it('resets a stranded run only while it still runs the generation that was read', async () => {
    const first = await claimedRun();
    const second = await claimedRun();
    const runs = (await repository.inFlightRuns()).filter((run) =>
      [first.id, second.id].includes(run.id),
    );
    expect(runs).toEqual(
      expect.arrayContaining([
        { id: first.id, judgedOn: JUDGE, generation: 1 },
        { id: second.id, judgedOn: JUDGE, generation: 1 },
      ]),
    );
    await bridge.submissions.updateOne(
      { _id: second.id },
      { $set: { judgeGeneration: 2 } },
    );
    const reset = await repository.resetStrandedRuns(runs);
    expect(reset.map((job) => job.submissionId)).toEqual([first.id]);
    expect((await stored(second.id)).status).toBe('P');
  });
});
