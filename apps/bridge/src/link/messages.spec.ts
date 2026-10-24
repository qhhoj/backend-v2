import { status } from '@grpc/grpc-js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  Case,
  ErrorCode,
  Final,
  Hello,
  JudgeMessage,
  Outcome,
  PROTO_ROOT,
  RetryReason,
  Status,
} from '@libs/judge-proto';
import { gradeCases } from '@libs/judging';
import {
  caseRowsOf,
  clipBytes,
  finalReportOf,
  helloOf,
  refOf,
} from './messages';
import { ProtocolError } from './protocol-error';

const ID = '01920000-0000-7000-8000-000000000001';
const hello = (fields: Partial<Hello> = {}): Hello =>
  Hello.fromPartial({
    slots: 2,
    build: 'qhhoj-judge 0.1.0',
    runtimes: [{ languageKey: 'CPP17', name: 'g++', version: '13.2' }],
    ...fields,
  });
const thrown = (run: () => unknown): ProtocolError => {
  try {
    run();
  } catch (error) {
    return error as ProtocolError;
  }
  throw new Error('nothing was thrown');
};

describe('judge link messages', () => {
  it('normalises a Hello: runtimes with an impossible key dropped, labels clipped, resume candidates checked', () => {
    const info = helloOf(
      hello({
        build: 'b'.repeat(300),
        runtimes: [
          { languageKey: 'CPP17', name: 'g++', version: '13.2' },
          { languageKey: '../etc', name: 'x', version: '1' },
        ],
        inFlight: [
          { ref: { submissionId: ID, generation: 2 }, lastSeqSent: 4 },
        ],
      }),
      100,
    );
    expect(info).toEqual({
      slots: 2,
      build: 'b'.repeat(200),
      protocolMinor: 0,
      runtimes: [
        { language: 'CPP17', name: 'g++', version: '13.2', priority: 0 },
      ],
      features: [],
      inFlight: [{ ref: { submissionId: ID, generation: 2 }, lastSeqSent: 4 }],
    });
  });

  it.each([
    ['no slots', hello({ slots: 0 }), 100],
    ['65 slots', hello({ slots: 65 }), 100],
    [
      'more runs than slots',
      hello({
        slots: 1,
        inFlight: [1, 2].map(() => ({
          ref: { submissionId: ID, generation: 1 },
          lastSeqSent: 0,
        })),
      }),
      100,
    ],
    [
      'a resume candidate without a valid id',
      hello({
        inFlight: [
          { ref: { submissionId: '42', generation: 1 }, lastSeqSent: 0 },
        ],
      }),
      100,
    ],
  ])('refuses a Hello with %s as a protocol error', (_why, message, bytes) => {
    const error = thrown(() => helloOf(message, bytes));
    expect(error).toBeInstanceOf(ProtocolError);
    expect(error.code).toBe(ErrorCode.ERROR_CODE_PROTOCOL);
    expect(error.grpcStatus).toBe(status.INVALID_ARGUMENT);
  });

  it('refuses a Hello over 256 KiB as too large', () => {
    const error = thrown(() => helloOf(hello(), 256 * 1024 + 1));
    expect(error.code).toBe(ErrorCode.ERROR_CODE_TOO_LARGE);
    expect(error.grpcStatus).toBe(status.RESOURCE_EXHAUSTED);
  });

  it('accepts only a UUID ref of generation 1 or more', () => {
    expect(refOf({ submissionId: ID, generation: 1 })).toEqual({
      submissionId: ID,
      generation: 1,
    });
    for (const ref of [
      undefined,
      { submissionId: ID, generation: 0 },
      { submissionId: 'x', generation: 1 },
    ])
      expect(() => refOf(ref)).toThrow(ProtocolError);
  });

  it('maps cases to stored rows: statuses, batch 0 as none, negative and NaN measurements as 0, texts clipped by bytes', () => {
    const [row] = caseRowsOf([
      Case.fromPartial({
        position: 3,
        status: Status.STATUS_TLE,
        timeS: -1,
        memoryKib: Number.NaN,
        points: 0.5,
        total: 1,
        batch: 0,
        feedback: 'ố'.repeat(30),
        outputPrefix: 'x'.repeat(600),
      }),
    ]);
    expect(row).toEqual({
      position: 3,
      status: 'TLE',
      time: 0,
      juryTime: 0,
      memory: 0,
      points: 0.5,
      total: 1,
      batch: null,
      feedback: 'ố'.repeat(16),
      extendedFeedback: '',
      output: 'x'.repeat(512),
    });
    expect(
      caseRowsOf([
        Case.fromPartial({ position: 1, status: Status.STATUS_AC, batch: 2 }),
      ])[0].batch,
    ).toBe(2);
  });

  it("stores the checker and interactor CPU a judge reports per case (judge-v2's golden CaseResults)", () => {
    const golden = readFileSync(join(PROTO_ROOT, 'golden', 'judge-cases.bin'));
    const { body } = JudgeMessage.decode(golden);
    if (body?.$case !== 'cases') throw new Error('not a CaseResults');
    expect(
      caseRowsOf(body.cases.cases).map((row) => [row.time, row.juryTime]),
    ).toEqual([
      [0.015, 0],
      [0.02, 0.25],
      [0, 0],
    ]);
  });

  it('clamps case points to the case total, and a failed case never sums to full marks', () => {
    const rows = caseRowsOf([
      Case.fromPartial({
        position: 1,
        status: Status.STATUS_AC,
        points: 5,
        total: 1,
      }),
      Case.fromPartial({
        position: 2,
        status: Status.STATUS_WA,
        points: 1,
        total: 1,
      }),
    ]);
    expect(rows.map((row) => row.points)).toEqual([1, 1]);
    expect(gradeCases(rows)).toMatchObject({
      result: 'WA',
      casePoints: 1.9,
      caseTotal: 2,
    });
  });

  it('refuses a case without a known status and more than 256 cases in one message', () => {
    expect(() => caseRowsOf([Case.fromPartial({ position: 1 })])).toThrow(
      /no known status/,
    );
    const many = Array.from({ length: 257 }, (_unused, index) =>
      Case.fromPartial({ position: index + 1, status: Status.STATUS_AC }),
    );
    expect(thrown(() => caseRowsOf(many)).code).toBe(
      ErrorCode.ERROR_CODE_TOO_LARGE,
    );
  });

  it('reads a Final: outcome, clipped log, data version, a RETRY by its reason (refusal, transient deferral, failure); an unknown outcome is a protocol error', () => {
    expect(
      finalReportOf(
        Final.fromPartial({
          outcome: Outcome.OUTCOME_RETRY,
          log: 'l'.repeat(70000),
          dataVersionUsed: 4,
        }),
      ),
    ).toEqual({ kind: 'retry', log: 'l'.repeat(65536), dataVersionUsed: 4 });
    expect(
      finalReportOf(
        Final.fromPartial({
          outcome: Outcome.OUTCOME_RETRY,
          reason: RetryReason.RETRY_REASON_UNSUPPORTED,
        }),
      ).kind,
    ).toBe('refused');
    const retryWith = (reason: RetryReason) =>
      finalReportOf(
        Final.fromPartial({ outcome: Outcome.OUTCOME_RETRY, reason }),
      );
    expect(retryWith(RetryReason.RETRY_REASON_DATA_UNAVAILABLE)).toEqual({
      kind: 'deferred',
      reason: 'data',
      log: '',
      dataVersionUsed: 0,
    });
    expect(retryWith(RetryReason.RETRY_REASON_RUNTIME_MISSING)).toMatchObject({
      kind: 'deferred',
      reason: 'runtime',
    });
    expect(retryWith(RetryReason.RETRY_REASON_SANDBOX_FAILURE)).toMatchObject({
      kind: 'deferred',
      reason: 'sandbox',
    });
    expect(retryWith(RetryReason.RETRY_REASON_UNSPECIFIED).kind).toBe('retry');
    expect(() => finalReportOf(Final.fromPartial({}))).toThrow(ProtocolError);
  });

  it('clips at a code point boundary', () => {
    expect(clipBytes('aé', 2)).toBe('a');
    expect(clipBytes('aé', 3)).toBe('aé');
  });
});
