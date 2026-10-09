import { UUID } from 'mongodb';
import { sha256 } from '@libs/auth';
import { uuidStr } from '@libs/database';
import { MigrationService } from '../src/migration.service';
import { setupMigratorTest } from './setup';

const JOBS = [
  'contests',
  'contest-announcements',
  'contest-ranking-links',
  'contest-official-rankings',
];

describe('contest jobs', () => {
  let harness: Awaited<ReturnType<typeof setupMigratorTest>>;
  let migration: MigrationService;
  let reports: Record<string, string[]>;
  const contest = (id: number) =>
    harness.docOf('contests', 'judge_contest', id);

  beforeAll(async () => {
    harness = await setupMigratorTest();
    migration = harness.testingModule.get(MigrationService);
    reports = await migration.backfill(JOBS);
  });
  afterAll(() => harness.teardown());

  it('maps an ICPC contest: seconds, hashed code, camelCased validated config, tags, banned judge names', async () => {
    expect(await contest(5001)).toMatchObject({
      key: 'c5',
      descriptionHtml: expect.stringContaining(
        '<strong>rules</strong>',
      ) as string,
      startTime: new Date('2022-01-01T00:00:00Z'),
      timeLimit: 7200,
      accessCodeHash: sha256('open'),
      rankingAccessCodeHash: null,
      formatName: 'icpc',
      formatConfig: { penalty: 10 },
      labelStyle: 'numeric',
      tags: ['vong-1'],
      bannedJudges: ['j5'],
      frozenLastMinutes: 30,
      pointsPrecision: 2,
      isRated: true,
    });
  });

  it('stores the v2-only rules and auto-publish fields at their defaults', async () => {
    expect(await contest(5001)).toMatchObject({
      rules: '',
      rulesHtml: '',
      rulesRevision: 0,
      publishAfterEnd: false,
      publishAfterEndBy: null,
      autoPublishOutcome: null,
    });
  });

  it('embeds problems in order, renumbered, unlimited submissions as null, skipping unknown problems', async () => {
    const { problems } = (await contest(5001)) as unknown as {
      problems: { problem: UUID }[];
    };
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({
      points: 100,
      partial: true,
      order: 0,
      maxSubmissions: null,
    });
    expect(uuidStr(problems[0].problem)).toBe(
      uuidStr(await harness.uuidOf('judge_problem', 5001)),
    );
  });

  it('lowercases Ultimate, turns a Lua label script into alpha and reports dropped fields', async () => {
    expect(await contest(5002)).toMatchObject({
      formatName: 'ultimate',
      formatConfig: {},
      labelStyle: 'alpha',
      timeLimit: null,
    });
    expect(await contest(5003)).toMatchObject({
      formatName: 'final_submission',
      formatConfig: { autoJudge: false },
      rankingAccessCodeHash: sha256('rank-code'),
    });
    expect(reports.contests).toEqual(
      expect.arrayContaining([
        'judge_contest:5002 Lua label script → alpha',
        'judge_contest:5002 og_image/logo_override_image not migrated',
      ]),
    );
  });

  it('maps announcements with rendered text and skips orphans', async () => {
    expect(
      await harness.docOf(
        'contestAnnouncements',
        'judge_contestannouncement',
        5001,
      ),
    ).toMatchObject({
      title: 'Hi',
      descriptionHtml: expect.stringContaining('<em>x</em>') as string,
      createdAt: new Date('2022-01-01T01:00:00Z'),
    });
    expect(
      await harness.docOf(
        'contestAnnouncements',
        'judge_contestannouncement',
        5002,
      ),
    ).toBeNull();
  });

  it('maps a public ranking link and the parsed official ranking', async () => {
    expect(
      await harness.docOf(
        'contestPublicRankingLinks',
        'judge_contestpublicrankinglink',
        5001,
      ),
    ).toMatchObject({
      token: 'abcdefghijklmnopqr',
      status: 'public',
      expiryMode: 'U',
      expiryAmount: null,
      regeneratedAt: new Date('2022-01-02T00:00:00Z'),
    });
    expect(
      await harness.docOf('contestOfficialRankings', 'judge_contest', 5001),
    ).toMatchObject({
      url: null,
      problems: ['A', 'B'],
      rows: [
        {
          username: 'ana',
          fullName: 'Ana',
          scores: [100, 50],
          totalScore: 150,
        },
      ],
    });
    expect(
      await harness.docOf('contestOfficialRankings', 'judge_contest', 5002),
    ).toBeNull();
  });

  it('verifies clean', async () => {
    expect(await migration.verify(JOBS)).toBe(0);
  });
});
