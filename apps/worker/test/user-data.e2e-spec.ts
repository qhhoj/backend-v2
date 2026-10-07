import { existsSync, readdirSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { userDataPath } from '@libs/community';
import { newId } from '@libs/database';
import {
  DEFAULT_USER_DATA_LIMITS,
  USER_DATA_LIMITS,
  UserDataError,
  UserDataService,
} from '../src/jobs/user-data/user-data.service';
import { seedGraded, seedProblem, seedUser } from './effects-fixtures';
import { readZip } from './read-zip';
import { setupWorkerTest } from './setup';
import type { WorkerTest } from './setup';

describe('user data export', () => {
  const limits = { ...DEFAULT_USER_DATA_LIMITS };
  let worker: WorkerTest;
  let service: UserDataService;
  let cppId: string;

  beforeAll(async () => {
    worker = await setupWorkerTest({
      overrides: [{ provide: USER_DATA_LIMITS, useValue: limits }],
    });
    service = worker.module.get(UserDataService);
    cppId = (
      await worker.languages.create({
        key: 'CPP17',
        name: 'C++17',
        commonName: 'C++',
        ace: 'c_cpp',
        pygments: 'cpp',
        extension: 'cpp',
      })
    )._id;
  });
  afterEach(() => Object.assign(limits, DEFAULT_USER_DATA_LIMITS));
  afterAll(() => worker.teardown());

  it("exports only the requester's submissions and no secret fields", async () => {
    const owner = await seedUser(worker, {
      email: 'owner@example.com',
      password: 'pbkdf2_sha256$secret',
      totpKey: 'TOTPSECRET',
      apiTokenHash: 'hash',
      notes: 'staff only',
      about: 'me',
    });
    const other = await seedUser(worker);
    const problem = await seedProblem(worker, { code: 'export_me' });
    const mine = await seedGraded(worker, owner._id, problem._id, {
      language: cppId,
      time: 0.5,
      memory: 1024,
    });
    const theirs = await seedGraded(worker, other._id, problem._id, {
      language: cppId,
    });
    await worker.submissionSources.create([
      { _id: mine._id, source: 'int main() { return 0; }' },
      { _id: theirs._id, source: 'not yours' },
    ]);
    expect(await service.prepare(owner._id)).toBe(3);
    const files = await readZip(userDataPath(worker.userDataRoot, owner._id));
    expect(Object.keys(files).sort()).toEqual([
      'profile.json',
      `submissions/${mine._id}.cpp`,
      'submissions/info.json',
    ]);
    expect(files[`submissions/${mine._id}.cpp`]).toBe(
      'int main() { return 0; }',
    );
    expect(JSON.parse(files['submissions/info.json'])).toEqual({
      [mine._id]: {
        problem: 'export_me',
        date: mine.date.toISOString(),
        time: 0.5,
        memory: 1024,
        language: 'CPP17',
        status: 'D',
        result: 'AC',
        case_points: 1,
        case_total: 1,
      },
    });
    expect(JSON.parse(files['profile.json'])).toMatchObject({
      username: owner.username,
      email: 'owner@example.com',
      about: 'me',
    });
    for (const secret of [
      'pbkdf2',
      'TOTPSECRET',
      'hash',
      'staff only',
      'not yours',
    ])
      expect(JSON.stringify(files)).not.toContain(secret);
  });

  it('exports across source chunks in submission order', async () => {
    limits.sourceChunk = 2;
    const owner = await seedUser(worker);
    const problem = await seedProblem(worker);
    const expected: Record<string, string> = {};
    for (const index of [0, 1, 2, 3, 4]) {
      const submission = await seedGraded(worker, owner._id, problem._id, {
        language: cppId,
      });
      await worker.submissionSources.create({
        _id: submission._id,
        source: `source ${index}`,
      });
      expected[`submissions/${submission._id}.cpp`] = `source ${index}`;
    }
    expect(await service.prepare(owner._id)).toBe(7);
    const files = await readZip(userDataPath(worker.userDataRoot, owner._id));
    for (const [name, source] of Object.entries(expected))
      expect(files[name]).toBe(source);
  });

  it('exports the profile alone for a user without submissions', async () => {
    const owner = await seedUser(worker);
    expect(await service.prepare(owner._id)).toBe(1);
    const files = await readZip(userDataPath(worker.userDataRoot, owner._id));
    expect(Object.keys(files)).toEqual(['profile.json']);
  });

  it('replaces the previous zip with the new one', async () => {
    const owner = await seedUser(worker);
    await service.prepare(owner._id);
    const problem = await seedProblem(worker);
    await seedGraded(worker, owner._id, problem._id, { language: cppId });
    expect(await service.prepare(owner._id)).toBe(3);
    const files = await readZip(userDataPath(worker.userDataRoot, owner._id));
    expect(Object.keys(files)).toHaveLength(3);
  });

  it('aborts at the byte cap and leaves no file behind', async () => {
    const owner = await seedUser(worker);
    const problem = await seedProblem(worker);
    const submission = await seedGraded(worker, owner._id, problem._id, {
      language: cppId,
    });
    await worker.submissionSources.create({
      _id: submission._id,
      source: 'x'.repeat(5000),
    });
    limits.maxBytes = 1000;
    await expect(service.prepare(owner._id)).rejects.toThrow(UserDataError);
    expect(
      readdirSync(worker.userDataRoot).filter((name) =>
        name.startsWith(owner._id),
      ),
    ).toEqual([]);
  });

  it('refuses a user with more submissions than the entry cap', async () => {
    const owner = await seedUser(worker);
    const problem = await seedProblem(worker);
    await seedGraded(worker, owner._id, problem._id, { language: cppId });
    await seedGraded(worker, owner._id, problem._id, { language: cppId });
    limits.maxEntries = 1;
    await expect(service.prepare(owner._id)).rejects.toThrow(UserDataError);
  });

  it('sweeps zips older than seven days and stale temp files, keeping fresh ones', async () => {
    const [fresh, stale] = [
      userDataPath(worker.userDataRoot, newId()),
      userDataPath(worker.userDataRoot, newId()),
    ];
    const temporary = join(worker.userDataRoot, `${newId()}.zip.run.tmp`);
    for (const path of [fresh, stale, temporary]) writeFileSync(path, 'zip');
    const eightDaysAgo = new Date(Date.now() - 8 * 86_400_000);
    utimesSync(stale, eightDaysAgo, eightDaysAgo);
    utimesSync(temporary, eightDaysAgo, eightDaysAgo);
    expect(await service.sweep()).toBe(2);
    expect([
      existsSync(fresh),
      existsSync(stale),
      existsSync(temporary),
    ]).toEqual([true, false, false]);
  });
});
