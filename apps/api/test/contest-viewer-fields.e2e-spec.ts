import { sha256 } from '@libs/auth';
import type { SubmissionStatus, User } from '@libs/database';
import { profileQueries } from '@libs/database/testing';
import type { ContestDetailResponse } from '../src/modules/contests/core/dto/contest-detail.response';
import type { ContestListItemResponse } from '../src/modules/contests/core/dto/contest-list.response';
import type { RankingResponse } from '../src/modules/contests/ranking/dto/ranking.response';
import {
  contestProblem,
  contestUrl,
  createContest,
  hoursFromNow,
  joinParticipation,
  makeCurrent,
} from './contest-fixtures';
import {
  authed,
  createProblem,
  createUserWith,
  loginAs,
  seedCatalog,
} from './problem-fixtures';
import type { Catalog, TestSession } from './problem-fixtures';
import { dataOf, seedSubmission } from './submission-fixtures';
import { setupApiTest } from './setup';
import type { ApiTest } from './setup';

describe('contest viewer fields', () => {
  let api: ApiTest;
  let catalog: Catalog;
  const sessions: Record<string, TestSession> = {};
  const users: Record<string, { _id: string }> = {};
  const problems: Array<{ _id: string }> = [];
  const get = (url: string, who?: string) =>
    who ? authed(api.http().get(url), sessions[who]) : api.http().get(url);
  const listed = async (search: string, who?: string) =>
    dataOf<ContestListItemResponse[]>(
      await get(
        `/api/internal/contests?search=${search}&pageSize=100`,
        who,
      ).expect(200),
    );
  const byKey = (rows: ContestListItemResponse[]) =>
    Object.fromEntries(rows.map((row) => [row.key, row]));
  const detail = async (key: string, who?: string) =>
    dataOf<ContestDetailResponse>(await get(contestUrl(key), who).expect(200));

  const ranking = async (key: string, who: string) =>
    dataOf<RankingResponse>(
      await get(contestUrl(key, '/ranking'), who).expect(200),
    );

  beforeAll(async () => {
    api = await setupApiTest();
    catalog = await seedCatalog(api);
    const roles: Array<[string, Partial<User>]> = [
      ['alice', {}],
      ['bob', {}],
      ['carol', {}],
      ['dave', {}],
      ['erin', {}],
      ['author', { permissions: ['judge.edit_own_contest'] }],
    ];
    for (const [name, extra] of roles) {
      users[name] = await createUserWith(api, name, extra);
      sessions[name] = await loginAs(api, users[name]._id);
    }
    problems.push(
      await createProblem(api, catalog, { code: 'viewer_a' }),
      await createProblem(api, catalog, { code: 'viewer_b' }),
    );
  });
  afterAll(() => api.teardown());

  describe('list rows', () => {
    it("shows each row the contest's join rules and, to a signed-in viewer, their live state and current contest", async () => {
      const upcoming = await createContest(api, {
        name: 'state_upcoming',
        startTime: hoursFromNow(1),
        endTime: hoursFromNow(3),
        registrationStart: hoursFromNow(-1),
        registrationEnd: hoursFromNow(0.5),
        accessCodeHash: sha256('opensesame'),
      });
      const running = await createContest(api, { name: 'state_running' });
      const timedOut = await createContest(api, {
        name: 'state_timed_out',
        timeLimit: 600,
      });
      const ended = await createContest(api, {
        name: 'state_ended',
        startTime: hoursFromNow(-5),
        endTime: hoursFromNow(-1),
        disallowVirtual: true,
      });
      await joinParticipation(api, upcoming._id, users.alice._id, {
        isRegistered: true,
        realStart: upcoming.startTime,
      });
      const live = await joinParticipation(api, running._id, users.alice._id);
      await makeCurrent(api, users.alice._id, live._id);
      await joinParticipation(api, ended._id, users.alice._id, {
        realStart: hoursFromNow(-5),
      });
      const expired = await joinParticipation(
        api,
        timedOut._id,
        users.bob._id,
        { realStart: hoursFromNow(-0.5) },
      );
      await makeCurrent(api, users.bob._id, expired._id);

      const anonymous = byKey(await listed('state_'));
      expect(anonymous[upcoming.key]).toMatchObject({
        requiresAccessCode: true,
        disallowVirtual: false,
        registrationStart: upcoming.registrationStart!.toISOString(),
        registrationEnd: upcoming.registrationEnd!.toISOString(),
        viewer: null,
      });
      expect(anonymous[ended.key]).toMatchObject({
        requiresAccessCode: false,
        disallowVirtual: true,
        registrationStart: null,
        registrationEnd: null,
      });
      expect(JSON.stringify(anonymous)).not.toContain('accessCodeHash');

      const alice = byKey(await listed('state_', 'alice'));
      expect(alice[upcoming.key].viewer).toEqual({
        liveStatus: 'registered',
        isCurrent: false,
      });
      expect(alice[running.key].viewer).toEqual({
        liveStatus: 'participating',
        isCurrent: true,
      });
      expect(alice[ended.key].viewer).toEqual({
        liveStatus: 'finished',
        isCurrent: false,
      });
      expect(alice[timedOut.key].viewer).toEqual({
        liveStatus: null,
        isCurrent: false,
      });
      expect((await detail(running.key, 'alice')).viewer).toMatchObject({
        liveStatus: 'participating',
        isCurrent: true,
        inContest: true,
      });
      // The pointer still names a participation whose time ran out: not "current", even before a read clears it.
      expect(byKey(await listed('state_', 'bob'))[timedOut.key].viewer).toEqual(
        { liveStatus: 'finished', isCurrent: false },
      );
    });

    it('marks the contest of a running virtual participation as current', async () => {
      const ended = await createContest(api, {
        name: 'virtual_current',
        startTime: hoursFromNow(-5),
        endTime: hoursFromNow(-1),
      });
      const run = await joinParticipation(api, ended._id, users.carol._id, {
        virtual: 1,
        realStart: hoursFromNow(-0.5),
      });
      await makeCurrent(api, users.carol._id, run._id);
      const [row] = await listed('virtual_current', 'carol');
      expect(row.viewer).toEqual({ liveStatus: null, isCurrent: true });
      expect((await detail(ended.key, 'carol')).viewer).toMatchObject({
        liveStatus: null,
        isCurrent: true,
        inContest: true,
      });
    });

    it("reads only the viewer's rows in the page's contests with one query on the unique participation index", async () => {
      const page = [];
      for (let index = 0; index < 3; index += 1)
        page.push(await createContest(api, { name: `indexed_${index}` }));
      const elsewhere = await createContest(api, { name: 'unrelated_contest' });
      await joinParticipation(api, page[0]._id, users.dave._id);
      await joinParticipation(api, page[1]._id, users.dave._id, { virtual: 1 });
      await joinParticipation(api, elsewhere._id, users.dave._id);
      await joinParticipation(api, page[0]._id, users.erin._id);
      await joinParticipation(api, page[2]._id, users.erin._id);
      const operations = await profileQueries(api.db, () =>
        get('/api/internal/contests?search=indexed_', 'dave').expect(200),
      );
      const reads = operations.filter(
        ({ collection }) => collection === 'contestParticipations',
      );
      expect(reads).toHaveLength(1);
      expect(reads[0].planSummary).toContain('contest: 1, user: 1, virtual: 1');
      // Dave's two rows on the page; his row elsewhere and Erin's rows are never read.
      expect(reads[0].docsExamined).toBe(2);
      expect(reads[0].keysExamined).toBeLessThanOrEqual(4);
    });
  });

  describe('access code and anonymous viewer', () => {
    it('never exposes the access code, in a list row or on the detail', async () => {
      const guarded = await createContest(api, {
        name: 'guarded_code',
        accessCodeHash: sha256('opensesame'),
      });
      const listBody = JSON.stringify(await listed('guarded_code', 'alice'));
      const detailBody = JSON.stringify(await detail(guarded.key, 'alice'));
      for (const body of [listBody, detailBody]) {
        expect(body).not.toMatch(/accessCode(Hash)?"/);
        expect(body).not.toContain(sha256('opensesame'));
      }
      expect((await detail(guarded.key)).requiresAccessCode).toBe(true);
    });

    it('gives an anonymous visitor a detail viewer with no state', async () => {
      const open = await createContest(api, { name: 'anonymous_detail' });
      expect((await detail(open.key)).viewer).toMatchObject({
        liveStatus: null,
        isCurrent: false,
        inContest: false,
        liveParticipation: null,
      });
    });
  });

  describe('detail viewer live status', () => {
    it("reports 'registered' before the start and 'finished' after the end", async () => {
      const upcoming = await createContest(api, {
        name: 'detail_registered',
        startTime: hoursFromNow(1),
        endTime: hoursFromNow(3),
      });
      const ended = await createContest(api, {
        name: 'detail_finished',
        startTime: hoursFromNow(-5),
        endTime: hoursFromNow(-1),
      });
      await joinParticipation(api, upcoming._id, users.erin._id, {
        isRegistered: true,
        realStart: upcoming.startTime,
      });
      await joinParticipation(api, ended._id, users.erin._id, {
        realStart: hoursFromNow(-5),
      });
      expect((await detail(upcoming.key, 'erin')).viewer.liveStatus).toBe(
        'registered',
      );
      expect((await detail(ended.key, 'erin')).viewer.liveStatus).toBe(
        'finished',
      );
    });
  });

  describe('viewer results', () => {
    const submitIn = async (submission: {
      contestId: string;
      participationId: string;
      problemId: string;
      who: string;
      status: SubmissionStatus;
    }) => {
      const stored = await seedSubmission(api, {
        user: users[submission.who]._id,
        problem: submission.problemId,
        language: catalog.languages.cpp,
        contest: submission.contestId,
        status: submission.status,
        result: submission.status === 'D' ? 'WA' : null,
      });
      await api.contestSubmissions.create({
        _id: stored._id,
        participation: submission.participationId,
        contest: submission.contestId,
        problem: submission.problemId,
      });
    };
    const resultsOf = async (key: string, who: string) =>
      (await detail(key, who)).problems!.map((problem) => problem.viewerResult);

    it('shows the viewer their own cell, counted attempts and pending submissions per problem', async () => {
      const [first, second] = problems;
      const contest = await createContest(api, {
        name: 'results_open',
        authors: [users.author._id],
        problems: [
          contestProblem(first._id, 0, { maxSubmissions: 5 }),
          contestProblem(second._id, 1),
        ],
      });
      const cell = { time: 600, points: 100 };
      const own = await joinParticipation(api, contest._id, users.alice._id, {
        formatData: { [first._id]: cell },
        frozenFormatData: { [first._id]: cell },
      });
      await makeCurrent(api, users.alice._id, own._id);
      for (const status of ['D', 'IE', 'PD', 'QU'] as const)
        await submitIn({
          contestId: contest._id,
          participationId: own._id,
          problemId: first._id,
          who: 'alice',
          status,
        });
      const other = await joinParticipation(api, contest._id, users.bob._id);
      await submitIn({
        contestId: contest._id,
        participationId: other._id,
        problemId: second._id,
        who: 'bob',
        status: 'QU',
      });

      expect(await resultsOf(contest.key, 'alice')).toEqual([
        { cell, isSolved: true, attempts: 2, hasPendingSubmission: true },
        {
          cell: null,
          isSolved: false,
          attempts: 0,
          hasPendingSubmission: false,
        },
      ]);
      expect(await resultsOf(contest.key, 'author')).toEqual([null, null]);
    });

    it('shows a non-editor their frozen cell during a freeze, the cell their ranking row shows', async () => {
      const [first] = problems;
      const contest = await createContest(api, {
        name: 'results_frozen',
        formatName: 'icpc',
        frozenLastMinutes: 180,
        problems: [contestProblem(first._id, 0)],
      });
      const live = { time: 4000, points: 100, tries: 1 };
      const frozen = { time: null, points: 0, tries: 1, pending: true };
      const own = await joinParticipation(api, contest._id, users.bob._id, {
        score: 100,
        formatData: { [first._id]: live },
        frozenFormatData: { [first._id]: frozen },
      });
      await makeCurrent(api, users.bob._id, own._id);
      const [result] = await resultsOf(contest.key, 'bob');
      expect(result).toMatchObject({ cell: frozen, isSolved: false });
      const board = await ranking(contest.key, 'bob');
      expect(board.rows[0].cells[first._id]).toEqual(result!.cell);
    });

    it('shows a viewer of a hidden, ended board their own cell, as their ranking row does', async () => {
      const [first] = problems;
      const contest = await createContest(api, {
        name: 'results_hidden',
        scoreboardVisibility: 'H',
        startTime: hoursFromNow(-5),
        endTime: hoursFromNow(-1),
        problems: [contestProblem(first._id, 0)],
      });
      const cell = { time: 60, points: 40 };
      await joinParticipation(api, contest._id, users.dave._id, {
        realStart: hoursFromNow(-5),
        formatData: { [first._id]: cell },
        frozenFormatData: { [first._id]: cell },
      });
      const [result] = await resultsOf(contest.key, 'dave');
      expect(result).toMatchObject({ cell, isSolved: false });
      expect(
        (await ranking(contest.key, 'dave')).rows.map(
          (row) => row.cells[first._id],
        ),
      ).toEqual([cell]);
    });

    it('follows the running virtual participation, not the finished live one', async () => {
      const [first] = problems;
      const contest = await createContest(api, {
        name: 'results_virtual',
        startTime: hoursFromNow(-5),
        endTime: hoursFromNow(-1),
        problems: [contestProblem(first._id, 0)],
      });
      const solved = { [first._id]: { time: 60, points: 100 } };
      await joinParticipation(api, contest._id, users.erin._id, {
        realStart: hoursFromNow(-5),
        formatData: solved,
        frozenFormatData: solved,
      });
      const run = await joinParticipation(api, contest._id, users.erin._id, {
        virtual: 1,
        realStart: hoursFromNow(-0.5),
      });
      await makeCurrent(api, users.erin._id, run._id);
      expect(await resultsOf(contest.key, 'erin')).toEqual([
        {
          cell: null,
          isSolved: false,
          attempts: 0,
          hasPendingSubmission: false,
        },
      ]);
    });

    it("reads the viewer's own submissions through the participation index", async () => {
      const [first] = problems;
      const contest = await createContest(api, {
        name: 'results_indexed',
        startTime: hoursFromNow(-5),
        endTime: hoursFromNow(-1),
        problems: [contestProblem(first._id, 0)],
      });
      const own = await joinParticipation(api, contest._id, users.carol._id, {
        realStart: hoursFromNow(-5),
      });
      await submitIn({
        contestId: contest._id,
        participationId: own._id,
        problemId: first._id,
        who: 'carol',
        status: 'D',
      });
      const operations = await profileQueries(api.db, () =>
        get(contestUrl(contest.key), 'carol').expect(200),
      );
      const ownReads = operations.filter(
        ({ collection }) => collection === 'contestSubmissions',
      );
      expect(ownReads).toHaveLength(1);
      expect(ownReads[0].planSummary).toContain('participation: 1, problem: 1');
      const statusReads = operations.filter(
        ({ collection }) => collection === 'submissions',
      );
      expect(statusReads).toHaveLength(1);
      expect(statusReads[0].planSummary).not.toContain('COLLSCAN');
      expect(statusReads[0].docsExamined).toBe(1);
    });
  });
});
