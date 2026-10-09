import {
  comparableOf,
  isFrozenForSync,
  isSameSyncedContest,
  toEditDto,
} from './sync-contest-fields';

const body = {
  name: 'Round',
  startTime: '2026-10-10T08:00:00Z',
  endTime: '2026-10-10T11:00:00Z',
  problems: [
    { code: 'a', points: 100 },
    { code: 'b', points: 50, partial: false },
  ],
};
const ids = new Map([
  ['a', 'id-a'],
  ['b', 'id-b'],
]);

describe('toEditDto', () => {
  it('sends every field explicitly, so an omitted optional field returns to its default', () => {
    expect(toEditDto(body, ids)).toEqual({
      name: 'Round',
      description: '',
      startTime: body.startTime,
      endTime: body.endTime,
      timeLimit: null,
      frozenLastMinutes: 0,
      formatName: 'default',
      formatConfig: {},
      problems: [
        { problem: 'id-a', points: 100, partial: true },
        { problem: 'id-b', points: 50, partial: false },
      ],
    });
  });
  it('carries what the client set', () => {
    const dto = toEditDto(
      {
        ...body,
        description: 'D',
        timeLimit: 600,
        frozenLastMinutes: 30,
        formatName: 'icpc',
        formatConfig: { penalty: 20 },
      },
      ids,
    );
    expect(dto).toMatchObject({
      description: 'D',
      timeLimit: 600,
      frozenLastMinutes: 30,
      formatName: 'icpc',
      formatConfig: { penalty: 20 },
    });
  });
});

describe('comparableOf', () => {
  const stored = {
    name: 'Round',
    description: '',
    startTime: new Date('2026-10-10T08:00:00Z'),
    endTime: new Date('2026-10-10T11:00:00Z'),
    timeLimit: null,
    frozenLastMinutes: 0,
    formatName: 'icpc' as const,
    formatConfig: { penalty: 20, lsoTimeLimit: 0 },
    problems: [
      { problem: 'id-a', points: 100, partial: true, order: 0 },
      { problem: 'id-b', points: 50, partial: false, order: 1 },
    ],
  } as unknown as Parameters<typeof comparableOf>[0];

  it('is equal for the same contest however dates, config keys and problem rows are ordered', () => {
    const respelled = {
      ...stored,
      startTime: new Date(stored.startTime.getTime()),
      formatConfig: { lsoTimeLimit: 0, penalty: 20 },
      problems: [...stored.problems].reverse(),
    };
    expect(comparableOf(respelled)).toEqual(comparableOf(stored));
    expect(isSameSyncedContest(respelled, stored)).toBe(true);
  });
  it('differs when any synced field differs', () => {
    for (const change of [
      { name: 'Other' },
      { description: 'D' },
      { startTime: new Date('2026-10-10T07:00:00Z') },
      { endTime: new Date('2026-10-10T12:00:00Z') },
      { timeLimit: 600 },
      { frozenLastMinutes: 5 },
      { formatName: 'default' },
      { formatConfig: { penalty: 10, lsoTimeLimit: 0 } },
      {
        problems: [
          { problem: 'id-a', points: 90, partial: true, order: 0 },
          { problem: 'id-b', points: 50, partial: false, order: 1 },
        ],
      },
      {
        problems: [
          { problem: 'id-b', points: 50, partial: false, order: 0 },
          { problem: 'id-a', points: 100, partial: true, order: 1 },
        ],
      },
      {
        problems: [
          { problem: 'id-a', points: 100, partial: false, order: 0 },
          { problem: 'id-b', points: 50, partial: false, order: 1 },
        ],
      },
    ])
      expect(
        isSameSyncedContest({ ...stored, ...change } as typeof stored, stored),
      ).toBe(false);
  });
});

describe('isFrozenForSync', () => {
  const now = new Date('2026-10-10T09:00:00Z');
  it('freezes a contest once a person published it or it started', () => {
    const at = (iso: string) => new Date(iso);
    expect(
      isFrozenForSync(
        { isVisible: false, startTime: at('2026-10-10T10:00:00Z') },
        now,
      ),
    ).toBe(false);
    expect(
      isFrozenForSync(
        { isVisible: true, startTime: at('2026-10-10T10:00:00Z') },
        now,
      ),
    ).toBe(true);
    expect(isFrozenForSync({ isVisible: false, startTime: now }, now)).toBe(
      true,
    );
    expect(
      isFrozenForSync(
        { isVisible: false, startTime: at('2026-10-10T08:00:00Z') },
        now,
      ),
    ).toBe(true);
  });
});
