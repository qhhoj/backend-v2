import { MAX_CASE_FEEDBACK_LENGTH, MAX_CASE_TEXT_LENGTH } from '@libs/database';
import {
  caseStatusFromBitmask,
  MAX_LOG_LENGTH,
  MAX_SUBMISSION_CASES,
  parseJudgePacket,
} from './judge-packets';
import { ProtocolError } from './protocol.error';

const id = '0192b0e0-0000-7000-8000-000000000001';
const reportedCase = (extra: Record<string, unknown> = {}) => ({
  position: 1,
  status: 0,
  time: 0.25,
  points: 1,
  'total-points': 1,
  memory: 2048,
  output: '',
  'extended-feedback': '',
  feedback: '',
  ...extra,
});

describe('caseStatusFromBitmask', () => {
  it.each([
    [0, 'AC'],
    [128, 'AC'],
    [4 | 1, 'TLE'],
    [8 | 64, 'MLE'],
    [64 | 2, 'OLE'],
    [2 | 16 | 1, 'RTE'],
    [16 | 1, 'IR'],
    [1 | 32, 'WA'],
    [32, 'SC'],
  ])('maps %i to %s, the first legacy flag winning', (bitmask, status) =>
    expect(caseStatusFromBitmask(bitmask)).toBe(status),
  );
});

describe('parseJudgePacket', () => {
  it('normalises a handshake: problem codes, executor keys and ranked runtimes', () =>
    expect(
      parseJudgePacket({
        name: 'handshake',
        id: 'judge-01',
        key: 'secret',
        problems: [
          ['sum', 1700000000.5],
          ['mul', 1],
        ],
        executors: {
          CPP17: [
            ['g++', [11, 4, 0]],
            ['clang++', null],
          ],
          PY3: [['python', '3.12']],
        },
      }),
    ).toEqual({
      name: 'handshake',
      id: 'judge-01',
      key: 'secret',
      problems: ['sum', 'mul'],
      executors: ['CPP17', 'PY3'],
      runtimes: [
        { language: 'CPP17', name: 'g++', version: '11.4.0', priority: 0 },
        { language: 'CPP17', name: 'clang++', version: '', priority: 1 },
        { language: 'PY3', name: 'python', version: '3.12', priority: 0 },
      ],
    }));
  it('maps a test-case batch, clipping texts and treating missing numbers as zero', () => {
    const packet = parseJudgePacket({
      name: 'test-case-status',
      'submission-id': id,
      cases: [
        reportedCase({
          status: 1,
          time: null,
          feedback: 'f'.repeat(80),
          output: 'o'.repeat(5000),
          'extended-feedback': 'e'.repeat(5000),
        }),
      ],
    });
    expect(packet).toEqual({
      name: 'test-case-status',
      submissionId: id,
      cases: [
        {
          position: 1,
          status: 'WA',
          time: 0,
          memory: 2048,
          points: 1,
          total: 1,
          feedback: 'f'.repeat(50),
          extendedFeedback: 'e'.repeat(MAX_CASE_TEXT_LENGTH),
          output: 'o'.repeat(MAX_CASE_TEXT_LENGTH),
        },
      ],
    });
  });
  it('clips compile logs and keeps pretested flags', () => {
    expect(
      parseJudgePacket({
        name: 'compile-error',
        'submission-id': id,
        log: 'x'.repeat(MAX_LOG_LENGTH + 10),
      }),
    ).toEqual({
      name: 'compile-error',
      submissionId: id,
      log: 'x'.repeat(MAX_LOG_LENGTH),
    });
    expect(
      parseJudgePacket({
        name: 'grading-begin',
        'submission-id': id,
        pretested: true,
      }),
    ).toEqual({ name: 'grading-begin', submissionId: id, pretested: true });
  });
  it('reads a ping response with or without a load', () => {
    expect(
      parseJudgePacket({
        name: 'ping-response',
        when: 10,
        time: 11,
        load: 0.5,
      }),
    ).toEqual({ name: 'ping-response', when: 10, load: 0.5 });
    expect(parseJudgePacket({ name: 'ping-response', when: 10 })).toEqual({
      name: 'ping-response',
      when: 10,
      load: null,
    });
  });
  it('ignores packets it does not know', () =>
    expect(parseJudgePacket({ name: 'current-submission-id' })).toBeNull());
  it.each([
    [{ name: 'handshake', id: 'judge-01', problems: [], executors: {} }],
    [
      {
        name: 'handshake',
        id: 'x'.repeat(101),
        key: 'k',
        problems: [],
        executors: {},
      },
    ],
    [
      {
        name: 'handshake',
        id: 'judge-01',
        key: 'k',
        problems: [[1, 2]],
        executors: {},
      },
    ],
    [
      {
        name: 'handshake',
        id: 'judge-01',
        key: 'k',
        problems: [],
        executors: [],
      },
    ],
    [
      {
        name: 'handshake',
        id: 'judge-01',
        key: 'k',
        problems: Array.from({ length: 100001 }, () => ['p', 0]),
        executors: {},
      },
    ],
    [{ name: 'grading-end' }],
    [{ name: 'grading-end', 'submission-id': 7 }],
    [{ name: 'compile-error', 'submission-id': id }],
    [{ name: 'test-case-status', 'submission-id': id, cases: [] }],
    [
      {
        name: 'test-case-status',
        'submission-id': id,
        cases: [reportedCase({ position: 1.5 })],
      },
    ],
    [
      {
        name: 'test-case-status',
        'submission-id': id,
        cases: [reportedCase({ points: 'all' })],
      },
    ],
    [{ name: 'supported-problems', problems: 'sum' }],
    [{ name: 'ping-response', when: 'now' }],
  ])('refuses the malformed %j', (packet) =>
    expect(() => parseJudgePacket(packet)).toThrow(ProtocolError),
  );
  it('refuses more than 10000 cases in one packet', () =>
    expect(() =>
      parseJudgePacket({
        name: 'test-case-status',
        'submission-id': id,
        cases: Array.from(
          { length: MAX_SUBMISSION_CASES + 1 },
          (_unused, index) => reportedCase({ position: index + 1 }),
        ),
      }),
    ).toThrow(ProtocolError));
  it('clamps negative measurements to zero', () => {
    const packet = parseJudgePacket({
      name: 'test-case-status',
      'submission-id': id,
      cases: [
        reportedCase({ time: -1, memory: -5, points: -2, 'total-points': -3 }),
      ],
    });
    expect(packet).toMatchObject({
      cases: [{ time: 0, memory: 0, points: 0, total: 0 }],
    });
  });
  it.each([0, -1, 1.5])('refuses case position %s', (position) =>
    expect(() =>
      parseJudgePacket({
        name: 'test-case-status',
        'submission-id': id,
        cases: [reportedCase({ position })],
      }),
    ).toThrow(ProtocolError),
  );
  it('keeps a ping load only when it is not negative', () => {
    expect(
      parseJudgePacket({ name: 'ping-response', when: 1, load: -0.5 }),
    ).toMatchObject({ load: null });
    expect(
      parseJudgePacket({ name: 'ping-response', when: 1, load: 0 }),
    ).toMatchObject({ load: 0 });
  });
  it('ignores problem codes no problem can have', () =>
    expect(
      parseJudgePacket({
        name: 'supported-problems',
        problems: [
          ['sum', 0],
          ['Has-Caps', 0],
          ['', 0],
          ['x'.repeat(33), 0],
          ['mul_2', 0],
        ],
      }),
    ).toEqual({ name: 'supported-problems', problems: ['sum', 'mul_2'] }));
  it('clips case texts by UTF-8 bytes without splitting a character', () => {
    const clipped = (field: string, text: string) => {
      const packet = parseJudgePacket({
        name: 'test-case-status',
        'submission-id': id,
        cases: [reportedCase({ [field]: text })],
      });
      const [report] = (
        packet as unknown as { cases: Array<Record<string, string>> }
      ).cases;
      return report[field === 'extended-feedback' ? 'extendedFeedback' : field];
    };
    for (const [field, limit] of [
      ['feedback', MAX_CASE_FEEDBACK_LENGTH],
      ['extended-feedback', MAX_CASE_TEXT_LENGTH],
      ['output', MAX_CASE_TEXT_LENGTH],
    ] as const)
      for (const glyph of ['日', '😀', 'é']) {
        const text = glyph.repeat(limit); // far over the byte limit, under it in characters
        const result = clipped(field, text);
        expect(Buffer.byteLength(result)).toBeLessThanOrEqual(limit);
        expect(Buffer.byteLength(result)).toBeGreaterThan(
          limit - Buffer.byteLength(glyph),
        );
        expect(text.startsWith(result)).toBe(true);
        expect(result).not.toContain('\ufffd');
      }
  });
  it('clips logs by bytes too', () => {
    const packet = parseJudgePacket({
      name: 'compile-error',
      'submission-id': id,
      log: '😀'.repeat(MAX_LOG_LENGTH),
    }) as { log: string };
    expect(Buffer.byteLength(packet.log)).toBe(MAX_LOG_LENGTH);
  });
});
