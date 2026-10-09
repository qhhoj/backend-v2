import {
  Flatpage,
  GeneralIssue,
  MiscConfig,
  NavigationItem,
  Ticket,
  uuidStr,
} from '@libs/database';
import { MigrationService } from '../src/migration.service';
import { setupMigratorTest } from './setup';

const JOBS = [
  'general-issues',
  'tickets',
  'flatpages',
  'misc-config',
  'navigation',
];

describe('site jobs', () => {
  let harness: Awaited<ReturnType<typeof setupMigratorTest>>;
  let migration: MigrationService;
  let reports: Record<string, string[]>;
  const id = async (table: string, legacyId: number) =>
    uuidStr(await harness.uuidOf(table, legacyId));
  const docOf = async <T>(
    collection: string,
    table: string,
    legacyId: number,
  ) =>
    (await harness.docOf(collection, table, legacyId)) as unknown as T | null;

  beforeAll(async () => {
    harness = await setupMigratorTest();
    migration = harness.testingModule.get(MigrationService);
    reports = await migration.backfill(JOBS);
  });
  afterAll(() => harness.teardown());

  it('links a ticket to its problem and embeds messages in time order', async () => {
    const ticket = (await docOf<Ticket>('tickets', 'judge_ticket', 9001))!;
    expect(ticket).toMatchObject({
      title: 'Wrong test',
      notes: 'n',
      isOpen: true,
      isContributive: true,
      messageCount: 2,
      lastMessageAt: new Date('2023-05-01T01:00:00Z'),
      createdAt: new Date('2023-05-01T00:00:00Z'),
    });
    expect(ticket.linkedItem.type).toBe('problem');
    expect(uuidStr(ticket.linkedItem.id)).toBe(await id('judge_problem', 9001));
    expect(ticket.messages.map((message) => message.body)).toEqual([
      '**first**',
      'second',
    ]);
    expect(ticket.messages[0].bodyHtml).toContain('<strong>first</strong>');
    expect(ticket.assignees.map(uuidStr)).toEqual([
      await id('judge_profile', 1002),
    ]);
    expect(reports.tickets).toContain('dropped judge_ticketmessage:9003');
  });

  it('links general tickets to their issue and skips other content types', async () => {
    const general = (await docOf<Ticket>('tickets', 'judge_ticket', 9002))!;
    expect(general).toMatchObject({
      isOpen: false,
      messageCount: 0,
      lastMessageAt: new Date('2023-05-02T00:00:00Z'),
    });
    expect(uuidStr(general.linkedItem.id)).toBe(
      await id('judge_generalissue', 9001),
    );
    expect(
      await docOf<GeneralIssue>('generalIssues', 'judge_generalissue', 9001),
    ).toMatchObject({ issueUrl: 'https://x.example/page' });
    expect(await docOf<Ticket>('tickets', 'judge_ticket', 9003)).toBeNull();
    expect(reports.tickets).toContain(
      'skipped judge_ticket:9003 (judge.contest not linkable)',
    );
  });

  it('canonicalises flatpage urls, first page per url wins', async () => {
    const page = (await docOf<Flatpage>('flatpages', 'django_flatpage', 9001))!;
    expect(page).toMatchObject({
      url: '/about',
      title: 'About',
      registrationRequired: false,
    });
    expect(page.contentHtml).toContain('<h3>Hi</h3>');
    expect(await docOf('flatpages', 'django_flatpage', 9002)).toBeNull();
    expect(await docOf('flatpages', 'django_flatpage', 9003)).toBeNull();
    expect(reports.flatpages).toEqual(
      expect.arrayContaining([
        'django_flatpage:9001 template_name not migrated',
        'django_flatpage:9001 enable_comments=0 not migrated',
      ]),
    );
  });

  it('keeps the last misc config row per key and reports Django templates', async () => {
    expect(
      await docOf<MiscConfig>('miscConfig', 'judge_miscconfig', 9002),
    ).toMatchObject({
      key: 'motd',
      value: 'new',
    });
    expect(await docOf('miscConfig', 'judge_miscconfig', 9001)).toBeNull();
    expect(reports['misc-config']).toContain(
      'judge_miscconfig key "home_page_top" holds a Django template',
    );
  });

  it('keeps the navigation tree and makes every regex compile', async () => {
    const child = (await docOf<NavigationItem>(
      'navigationBar',
      'judge_navigationbar',
      9002,
    ))!;
    expect(child).toMatchObject({
      key: 'subs',
      order: 2,
      hidden: true,
      regex: '^/submission',
    });
    expect(uuidStr(child.parentId)).toBe(await id('judge_navigationbar', 9001));
    expect(
      (await docOf<NavigationItem>(
        'navigationBar',
        'judge_navigationbar',
        9003,
      ))!.regex,
    ).toBe('');
    expect(reports.navigation).toEqual(
      expect.arrayContaining([
        'judge_navigationbar:9002 regex converted',
        'judge_navigationbar:9003 regex dropped',
      ]),
    );
  });

  it('verifies clean', async () => {
    expect(await migration.verify(JOBS)).toBe(0);
  });
});
