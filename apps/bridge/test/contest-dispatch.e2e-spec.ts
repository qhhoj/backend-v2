import { CommandsService } from '../src/dispatch/commands.service';
import { DispatchService } from '../src/dispatch/dispatch.service';
import { SubmissionsRepository } from '../src/submissions/submissions.repository';
import {
  seedCatalog,
  seedContestSubmission,
  seedProblem,
  seedSubmission,
} from './fixtures';
import type { BridgeCatalog } from './fixtures';
import { RecordingJudge } from './recording-judge';
import { setupBridgeTest } from './setup';
import type { BridgeTest } from './setup';

describe('contest submissions in the bridge', () => {
  let bridge: BridgeTest;
  let catalog: BridgeCatalog;
  let codes = 0;
  const dispatch = () => bridge.module.get(DispatchService);
  const repository = () => bridge.module.get(SubmissionsRepository);
  const enqueue = async (...ids: string[]) =>
    dispatch().enqueue(await repository().loadQueued(ids));
  const sentTo = (judge: RecordingJudge) =>
    judge.received.map((request) => request.submissionId);
  const minutesAgo = (minutes: number) =>
    new Date(Date.now() - minutes * 60_000);
  const contestWith = async (fields: object = {}) => {
    codes += 1;
    const problem = await seedProblem(bridge, catalog, { code: `cd${codes}` });
    const contest = await bridge.contests.create({
      key: `bridge_${codes}`,
      name: 'Bridge',
      startTime: new Date(Date.now() - 3_600_000),
      endTime: new Date(Date.now() + 3_600_000),
      bannedJudges: [`banned${codes}`],
      problems: [
        { problem: problem._id, points: 100, order: 0, isPretested: true },
      ],
      ...fields,
    });
    const participation = (virtual: number) =>
      bridge.participations.create({
        contest: contest._id,
        user: catalog.user._id,
        virtual,
        realStart: new Date(),
      });
    return { problem, contest, participation, banned: `banned${codes}` };
  };

  beforeAll(async () => {
    bridge = await setupBridgeTest();
    catalog = await seedCatalog(bridge);
  });
  afterAll(() => bridge.teardown());

  it('keeps a live contest submission away from banned judges across a restart and a rejudge', async () => {
    const { problem, contest, participation, banned } = await contestWith();
    const live = await participation(0);
    const { _id: id } = await seedContestSubmission(bridge, catalog, {
      contest: contest._id,
      participation: live._id,
      problem: problem._id,
    });
    const bannedJudge = new RecordingJudge(banned, [problem.code]);
    await dispatch().register(bannedJudge);
    await enqueue(id);
    expect(sentTo(bannedJudge)).toEqual([]);
    await bridge.restart();
    const bannedAgain = new RecordingJudge(banned, [problem.code]);
    await dispatch().register(bannedAgain);
    // A rejudge's command carries no bans; the ones from Mongo still hold.
    await bridge.module.get(CommandsService).apply(
      JSON.stringify({
        type: 'judge',
        submissionIds: [id],
        judgeName: null,
        bannedJudges: [],
      }),
    );
    expect(sentTo(bannedAgain)).toEqual([]);
    const allowed = new RecordingJudge(`allowed${codes}`, [problem.code]);
    await dispatch().register(allowed);
    expect(sentTo(allowed)).toEqual([id]);
  });

  it("adds a command's own bans to the contest's", async () => {
    const { problem, contest, participation, banned } = await contestWith();
    const live = await participation(0);
    const { _id: id } = await seedContestSubmission(bridge, catalog, {
      contest: contest._id,
      participation: live._id,
      problem: problem._id,
    });
    const extra = new RecordingJudge(`extra${codes}`, [problem.code]);
    const contestBanned = new RecordingJudge(banned, [problem.code]);
    await dispatch().register(extra);
    await dispatch().register(contestBanned);
    await bridge.module.get(CommandsService).apply(
      JSON.stringify({
        type: 'judge',
        submissionIds: [id],
        judgeName: null,
        bannedJudges: [extra.name],
      }),
    );
    expect(sentTo(extra)).toEqual([]);
    expect(sentTo(contestBanned)).toEqual([]);
    const allowed = new RecordingJudge(`free${codes}`, [problem.code]);
    await dispatch().register(allowed);
    expect(sentTo(allowed)).toEqual([id]);
  });

  it("lets a banned judge take a virtual participant's submission", async () => {
    const { problem, contest, participation, banned } = await contestWith();
    const virtual = await participation(1);
    const { _id: id } = await seedContestSubmission(bridge, catalog, {
      contest: contest._id,
      participation: virtual._id,
      problem: problem._id,
    });
    const judge = new RecordingJudge(banned, [problem.code]);
    await dispatch().register(judge);
    await enqueue(id);
    expect(sentTo(judge)).toEqual([id]);
  });

  it('never loads or claims a pending (PD) contest submission', async () => {
    const { problem, contest, participation } = await contestWith({
      bannedJudges: [],
    });
    const live = await participation(0);
    const { _id: id } = await seedContestSubmission(bridge, catalog, {
      contest: contest._id,
      participation: live._id,
      problem: problem._id,
      status: 'PD',
    });
    expect(await repository().loadQueued([id])).toEqual([]);
    expect(await repository().loadQueued()).not.toContainEqual(
      expect.objectContaining({ id }),
    );
    await bridge.restart();
    const judge = new RecordingJudge(`pd${codes}`, [problem.code]);
    await dispatch().register(judge);
    expect(sentTo(judge)).toEqual([]);
    expect((await bridge.submissions.findById(id).lean())!.status).toBe('PD');
  });

  it('sends the pretests flag, the participation number and the attempt within the participation', async () => {
    const { problem, contest, participation } = await contestWith({
      runPretestsOnly: true,
      bannedJudges: [],
    });
    const virtual = await participation(2);
    const otherParticipant = await participation(0);
    const own = {
      contest: contest._id,
      participation: virtual._id,
      problem: problem._id,
    };
    await seedSubmission(bridge, catalog, {
      problem: problem._id,
      status: 'D',
      result: 'WA',
      date: minutesAgo(40),
    });
    await seedContestSubmission(bridge, catalog, {
      ...own,
      participation: otherParticipant._id,
      status: 'D',
      result: 'WA',
      date: minutesAgo(30),
    });
    await seedContestSubmission(bridge, catalog, {
      ...own,
      status: 'D',
      result: 'WA',
      date: minutesAgo(20),
    });
    await seedContestSubmission(bridge, catalog, {
      ...own,
      status: 'CE',
      result: 'CE',
      date: minutesAgo(10),
    });
    const { _id: id } = await seedContestSubmission(bridge, catalog, own);
    const judge = new RecordingJudge(`meta${codes}`, [problem.code]);
    await dispatch().register(judge);
    await enqueue(id);
    expect(judge.received[0]).toMatchObject({
      submissionId: id,
      pretestsOnly: true,
      inContest: 2,
      attemptNo: 2,
    });
    await bridge.contests.updateOne(
      { _id: contest._id },
      { runPretestsOnly: false },
    );
    const { _id: rejudged } = await seedContestSubmission(bridge, catalog, own);
    const second = new RecordingJudge(`meta${codes}b`, [problem.code]);
    await dispatch().register(second);
    await enqueue(rejudged);
    expect(second.received[0]).toMatchObject({
      pretestsOnly: false,
      inContest: 2,
    });
  });

  it('sends no contest meta outside contests', async () => {
    const problem = await seedProblem(bridge, catalog, { code: 'plain_meta' });
    const { _id: id } = await seedSubmission(bridge, catalog, {
      problem: problem._id,
    });
    const judge = new RecordingJudge('plain_judge', [problem.code]);
    await dispatch().register(judge);
    await enqueue(id);
    expect(judge.received[0]).toMatchObject({
      pretestsOnly: false,
      inContest: null,
      attemptNo: 1,
    });
  });

  it('bans judges for a spectator like a live participant', async () => {
    const { problem, contest, participation, banned } = await contestWith();
    const spectating = await participation(-1);
    const { _id: id } = await seedContestSubmission(bridge, catalog, {
      contest: contest._id,
      participation: spectating._id,
      problem: problem._id,
    });
    const judge = new RecordingJudge(banned, [problem.code]);
    await dispatch().register(judge);
    await enqueue(id);
    expect(sentTo(judge)).toEqual([]);
  });

  it('judges on pretests only when the contest runs them and the problem has them', async () => {
    const { problem, contest, participation } = await contestWith({
      runPretestsOnly: true,
      bannedJudges: [],
      problems: [],
    });
    await bridge.contests.updateOne(
      { _id: contest._id },
      {
        problems: [
          { problem: problem._id, points: 100, order: 0, isPretested: false },
        ],
      },
    );
    const live = await participation(0);
    const { _id: id } = await seedContestSubmission(bridge, catalog, {
      contest: contest._id,
      participation: live._id,
      problem: problem._id,
    });
    const judge = new RecordingJudge(`nopre${codes}`, [problem.code]);
    await dispatch().register(judge);
    await enqueue(id);
    expect(judge.received[0]).toMatchObject({ pretestsOnly: false });
  });
});
