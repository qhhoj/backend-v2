import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getConnectionToken } from '@nestjs/mongoose';
import { newId, toUuid } from '@libs/database';
import { UUID } from 'mongodb';
import { Connection } from 'mongoose';
import { FileCheckService } from '../src/file-check.service';
import { IdMapRepository } from '../src/id-map.repository';
import { IntegrityCheckService } from '../src/integrity-check.service';
import { LegacySourceService } from '../src/legacy-source.service';
import { setupMigratorTest } from './setup';

describe('post-migration checks', () => {
  let harness: Awaited<ReturnType<typeof setupMigratorTest>>;
  let conn: Connection;
  let integrity: IntegrityCheckService;
  const docs = (name: string) =>
    conn.collection<{ _id: UUID } & Record<string, unknown>>(name);

  beforeAll(async () => {
    harness = await setupMigratorTest();
    conn = harness.testingModule.get<Connection>(getConnectionToken());
    // Lane L10 ids: one legacy-rated live participation of an imported contest and profile.
    await harness.mysql.query(
      `INSERT INTO ${harness.name}.judge_contest (id, \`key\`, name, start_time, end_time, is_rated, format_name, format_config, scoreboard_visibility) VALUES (10001, 'c10', 'C10', '2023-01-01 00:00:00', '2023-01-01 03:00:00', 1, 'default', '{}', 'V');
       INSERT INTO ${harness.name}.judge_contestparticipation (id, start, score, cumtime, \`virtual\`, contest_id, user_id) VALUES (10001, '2023-01-01 00:00:00', 1, 1, 0, 10001, 1);
       INSERT INTO ${harness.name}.judge_rating (id, \`rank\`, rating, last_rated, contest_id, participation_id, user_id) VALUES (10001, 1, 1600, '2023-01-02 00:00:00', 10001, 10001, 1);`,
    );
    const ids = harness.testingModule.get(IdMapRepository);
    await ids.build(['judge_contestparticipation']);
    integrity = new IntegrityCheckService(
      conn,
      harness.testingModule.get(LegacySourceService),
      ids,
    );
    process.env.MEDIA_URL = '/media';
  });
  afterAll(() => harness.teardown());

  it('lists referenced files that are missing, never escaping a root', async () => {
    const problemData = mkdtempSync(join(tmpdir(), 'pd-'));
    const media = mkdtempSync(join(tmpdir(), 'media-'));
    mkdirSync(join(problemData, 'sum'));
    writeFileSync(join(problemData, 'sum', 'tests.zip'), 'zip');
    // Exists, but outside `sum/`: only the root guard keeps it missing.
    writeFileSync(join(problemData, 'escape.txt'), 'x');
    await docs('problems').insertOne({
      _id: toUuid(newId()),
      code: 'sum',
      data: {
        archive: 'tests.zip',
        customChecker: 'check.cpp',
        generator: '../escape.txt',
      },
      materialUrl: '/media/m/sum.pdf',
      pdfStatementUrl: 'https://cdn.example/x.pdf',
    });
    await docs('submissionSources').insertOne({
      _id: toUuid(newId()),
      source: '/media/submission_file/sum/1/a.sb3',
    });
    const report = await new FileCheckService(conn).run({ problemData, media });
    expect(report.checked).toBe(5);
    expect(report.missing.sort()).toEqual(
      [
        'sum data.customChecker',
        'sum data.generator',
        'sum materialUrl',
        expect.stringMatching(/^submission source /) as string,
      ].sort(),
    );
  });

  it('reports broken cross-collection invariants with counts', async () => {
    const user = toUuid(newId());
    const submission = toUuid(newId());
    await docs('users').insertOne({ _id: user, rating: 1500 });
    await docs('submissions').insertOne({ _id: submission, user });
    await docs('contestSubmissions').insertOne({
      _id: toUuid(newId()),
      participation: toUuid(newId()),
    });
    await docs('ratings').insertOne({
      _id: toUuid(newId()),
      user,
      participation: toUuid(newId()),
      contest: toUuid(newId()),
      rating: 1600,
      contestEndTime: new Date(),
    });
    const lines = await integrity.run();
    expect(lines).toEqual(
      expect.arrayContaining([
        'submissions without a source: 1',
        'contestSubmissions whose submission is missing: 1',
        'contestSubmissions whose participation is missing: 1',
        'ratings whose participation is missing: 1',
        'users whose rating differs from their newest rating row: 1',
      ]),
    );
  });

  it('flags a missing contest problem and a ticket link, but not a ticket on a general issue', async () => {
    const issue = toUuid(newId());
    await docs('generalIssues').insertOne({ _id: issue });
    await docs('contests').insertOne({
      _id: toUuid(newId()),
      problems: [{ problem: toUuid(newId()) }],
    });
    await docs('tickets').insertMany([
      { _id: toUuid(newId()), linkedItem: { type: 'general', id: issue } },
      {
        _id: toUuid(newId()),
        linkedItem: { type: 'problem', id: toUuid(newId()) },
      },
    ]);
    const lines = await integrity.run();
    expect(lines).toContain('contest problems that are missing: 1');
    expect(lines).toContain('tickets whose linked item is missing: 1');
  });

  it('asserts that every legacy-rated participation has a v2 rating, and compares rated-contest counts', async () => {
    const before = await integrity.run();
    expect(before).toContain(
      'legacy-rated participations without a v2 rating: 1',
    );
    expect(before.some((line) => line.startsWith('rated contests:'))).toBe(
      false,
    );
    const participation = toUuid(
      harness.testingModule
        .get(IdMapRepository)
        .find('judge_contestparticipation', 10001)!,
    );
    await docs('ratings').insertOne({
      _id: toUuid(newId()),
      participation,
      contest: toUuid(newId()),
      user: toUuid(newId()),
      rating: 1500,
      contestEndTime: new Date(0),
    });
    const lines = await integrity.run();
    expect(
      lines.some((line) =>
        line.startsWith('legacy-rated participations without a v2 rating'),
      ),
    ).toBe(false);
    expect(lines).toContain('rated contests: legacy 1, v2 2');
  });
});
