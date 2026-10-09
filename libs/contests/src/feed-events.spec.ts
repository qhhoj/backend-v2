import { buildFeedEvents, contestTime } from './feed-events';
import type { FeedEvent, FeedInput } from './feed-events';

const START = new Date('2026-03-01T09:00:00.000Z');
const END = new Date('2026-03-01T14:00:00.000Z');
const at = (minutes: number) => new Date(START.getTime() + minutes * 60_000);

const input = (extra: Partial<FeedInput> = {}): FeedInput => ({
  contest: {
    id: 'c1',
    name: 'Round',
    startTime: START,
    endTime: END,
    frozenLastMinutes: 60,
    formatName: 'icpc',
    formatConfig: {},
  },
  now: new Date('2026-03-01T16:00:00.000Z'),
  isGated: false,
  releasedAt: null,
  languages: [{ id: 'l1', name: 'C++', extension: 'cpp' }],
  groups: [{ id: 'g1', name: 'School' }],
  teams: [
    { id: 't1', name: 'ann', groupIds: ['g1'], start: START },
    { id: 't2', name: 'bob', groupIds: [], start: START },
  ],
  problems: [{ id: 'p1', label: 'A', name: 'Sum', code: 'sum', ordinal: 0 }],
  submissions: [
    {
      id: 's1',
      teamId: 't1',
      problemId: 'p1',
      languageId: 'l1',
      date: at(10),
      result: 'WA',
      status: 'D',
      judgedDate: at(11),
    },
    {
      id: 's2',
      teamId: 't1',
      problemId: 'p1',
      languageId: 'l1',
      date: at(20),
      result: 'AC',
      status: 'D',
      judgedDate: at(21),
    },
    {
      id: 's3',
      teamId: 't2',
      problemId: 'p1',
      languageId: 'l1',
      date: at(15),
      result: null,
      status: 'QU',
      judgedDate: null,
    },
  ],
  ...extra,
});

const byType = (events: FeedEvent[], type: string) =>
  events.filter((event) => event.type === type);

/** Every id an event refers to must belong to an event that came earlier. Returns the dangling references. */
function dangling(events: FeedEvent[]): string[] {
  const seen = new Map<string, Set<string>>();
  const known = (type: string, id: string) => seen.get(type)?.has(id) ?? false;
  const missing: string[] = [];
  const check = (event: FeedEvent, field: string, type: string) => {
    const value = event.data[field];
    const ids = Array.isArray(value) ? value : value === null ? [] : [value];
    for (const id of ids)
      if (!known(type, String(id)))
        missing.push(`${event.type} ${event.id}: ${field}=${String(id)}`);
  };
  for (const event of events) {
    if (event.type === 'teams') check(event, 'group_ids', 'groups');
    if (event.type === 'submissions') {
      check(event, 'team_id', 'teams');
      check(event, 'problem_id', 'problems');
      check(event, 'language_id', 'languages');
    }
    if (event.type === 'judgements') {
      check(event, 'submission_id', 'submissions');
      check(event, 'judgement_type_id', 'judgement-types');
    }
    const ids = seen.get(event.type) ?? new Set<string>();
    if (event.id !== null) ids.add(event.id);
    seen.set(event.type, ids);
  }
  return missing;
}

describe('buildFeedEvents', () => {
  it('orders the types so every referenced id appears earlier, with strictly increasing tokens', () => {
    const events = buildFeedEvents(input());
    expect(dangling(events)).toEqual([]);
    const order = events.map((event) => event.type);
    expect(order[0]).toBe('contest');
    expect(order.at(-1)).toBe('state');
    expect(order.indexOf('submissions')).toBeLessThan(
      order.indexOf('judgements'),
    );
    const tokens = events.map((event) => Number(event.token));
    expect(tokens).toEqual([...tokens].sort((left, right) => left - right));
    expect(new Set(tokens).size).toBe(tokens.length);
  });

  it("lists submissions by time, with RFC 3339 times and contest time from each team's own start", () => {
    const late = input({
      teams: [
        { id: 't1', name: 'ann', groupIds: [], start: at(5) },
        { id: 't2', name: 'bob', groupIds: [], start: START },
      ],
    });
    const submissions = byType(buildFeedEvents(late), 'submissions');
    expect(submissions.map((event) => event.id)).toEqual(['s1', 's3', 's2']);
    expect(submissions[0].data).toMatchObject({
      team_id: 't1',
      time: '2026-03-01T09:10:00.000Z',
      contest_time: '0:05:00.000',
    });
    expect(submissions[1].data.contest_time).toBe('0:15:00.000');
  });

  it('drops a submission whose problem, language or team the feed does not list, so no id dangles', () => {
    const [, valid] = input().submissions;
    const events = buildFeedEvents(
      input({
        submissions: [
          valid,
          { ...valid, id: 'x1', problemId: 'gone' },
          { ...valid, id: 'x2', languageId: 'gone' },
          { ...valid, id: 'x3', teamId: 'gone' },
        ],
      }),
    );
    expect(byType(events, 'submissions').map((event) => event.id)).toEqual([
      's2',
    ]);
    expect(byType(events, 'judgements').map((event) => event.id)).toEqual([
      's2',
    ]);
    expect(dangling(events)).toEqual([]);
  });

  it('drops a group a team belongs to when the feed does not list that group', () => {
    const events = buildFeedEvents(
      input({
        teams: [
          { id: 't1', name: 'ann', groupIds: ['g1', 'hidden'], start: START },
        ],
      }),
    );
    expect(byType(events, 'teams')[0].data.group_ids).toEqual(['g1']);
    expect(dangling(events)).toEqual([]);
  });

  it('judges only finished submissions with a verdict, and names the judgement type', () => {
    const judgements = byType(buildFeedEvents(input()), 'judgements');
    expect(
      judgements.map((event) => [event.id, event.data.judgement_type_id]),
    ).toEqual([
      ['s1', 'WA'],
      ['s2', 'AC'],
    ]);
    expect(judgements[1].data).toMatchObject({
      submission_id: 's2',
      start_contest_time: '0:20:00.000',
      end_contest_time: '0:21:00.000',
    });
  });

  it('does not judge a submission that is being judged again, even if it kept an older result', () => {
    const rejudging = input({
      submissions: [
        {
          id: 's5',
          teamId: 't1',
          problemId: 'p1',
          languageId: 'l1',
          date: at(3),
          result: 'AC',
          status: 'G',
          judgedDate: null,
        },
      ],
    });
    const events = buildFeedEvents(rejudging);
    expect(byType(events, 'submissions').map((event) => event.id)).toEqual([
      's5',
    ]);
    expect(byType(events, 'judgements')).toEqual([]);
  });

  it.each([
    ['AC', 'AC'],
    ['WA', 'WA'],
    ['SC', 'WA'],
    ['TLE', 'TLE'],
    ['MLE', 'MLE'],
    ['OLE', 'OLE'],
    ['RTE', 'RTE'],
    ['IR', 'RTE'],
    ['CE', 'CE'],
    ['IE', undefined],
    ['AB', undefined],
    ['RJ', undefined],
  ] as const)('publishes result %s as judgement %s', (result, judgement) => {
    const events = buildFeedEvents(
      input({
        submissions: [
          {
            id: 's9',
            teamId: 't1',
            problemId: 'p1',
            languageId: 'l1',
            date: at(1),
            result,
            status: 'D',
            judgedDate: at(2),
          },
        ],
      }),
    );
    expect(
      byType(events, 'judgements').map((event) => event.data.judgement_type_id),
    ).toEqual(judgement ? [judgement] : []);
    expect(dangling(events)).toEqual([]);
  });

  it('cuts every submission and judgement at or after the freeze while gated, the boundary included', () => {
    const freeze = new Date(END.getTime() - 60 * 60_000);
    const submission = (id: string, date: Date) => ({
      id,
      teamId: 't1',
      problemId: 'p1',
      languageId: 'l1',
      date,
      result: 'AC' as const,
      status: 'D' as const,
      judgedDate: freeze,
    });
    const submissions = [
      submission('before', new Date(freeze.getTime() - 1)),
      submission('edge', freeze),
      submission('after', new Date(freeze.getTime() + 5000)),
    ];
    const now = new Date(END.getTime() - 10 * 60_000);
    const gated = buildFeedEvents(input({ submissions, now, isGated: true }));
    expect(byType(gated, 'submissions').map((event) => event.id)).toEqual([
      'before',
    ]);
    expect(byType(gated, 'judgements').map((event) => event.id)).toEqual([
      'before',
    ]);
    expect(byType(gated, 'state')[0].data).toMatchObject({
      frozen: freeze.toISOString(),
      thawed: null,
    });
    const open = buildFeedEvents(input({ submissions, now, isGated: false }));
    expect(byType(open, 'submissions').map((event) => event.id)).toEqual([
      'before',
      'edge',
      'after',
    ]);
  });

  it('reports the contest phases in the state event and a release as the thaw', () => {
    const running = buildFeedEvents(input({ now: at(30) }));
    expect(byType(running, 'state')[0].data).toMatchObject({
      started: START.toISOString(),
      ended: null,
      frozen: null,
    });
    const released = buildFeedEvents(
      input({
        now: new Date(END.getTime() - 10 * 60_000),
        releasedAt: at(250),
      }),
    );
    expect(byType(released, 'state')[0].data).toMatchObject({
      thawed: at(250).toISOString(),
    });
    const over = buildFeedEvents(input());
    expect(byType(over, 'state')[0].data).toMatchObject({
      ended: END.toISOString(),
      end_of_updates: END.toISOString(),
    });
  });

  it('describes the contest: duration, freeze length and the ICPC penalty', () => {
    const icpc = input({
      contest: { ...input().contest, formatConfig: { penalty: 10 } },
    });
    expect(byType(buildFeedEvents(icpc), 'contest')[0].data).toMatchObject({
      id: 'c1',
      name: 'Round',
      start_time: START.toISOString(),
      duration: '5:00:00.000',
      scoreboard_freeze_duration: '1:00:00.000',
      penalty_time: 10,
    });
    const plain = input({
      contest: {
        ...input().contest,
        formatName: 'default',
        frozenLastMinutes: 0,
      },
    });
    expect(byType(buildFeedEvents(plain), 'contest')[0].data).toMatchObject({
      scoreboard_freeze_duration: null,
      penalty_time: 0,
    });
  });
});

describe('contestTime', () => {
  it.each([
    [0, '0:00:00.000'],
    [5250, '0:00:05.250'],
    [3_909_250, '1:05:09.250'],
    [-5000, '-0:00:05.000'],
    [36_000_000, '10:00:00.000'],
  ])('formats %d ms as %s', (milliseconds, text) => {
    expect(contestTime(milliseconds)).toBe(text);
  });
});
