import { remoteRunOf } from './external-judge-types';
import {
  isProcessing,
  mapExternalResult,
  scorePercent,
  SUBMIT_FAILED_MESSAGE,
  UNSUPPORTED_STATUS_MESSAGE,
} from './external-result';

const finished = (fields: Record<string, unknown>) =>
  remoteRunOf({ systemStatus: 'done', processing: false, ...fields });
const PARTIAL = { partial: true };
const ALL_OR_NOTHING = { partial: false };

describe('mapExternalResult', () => {
  it.each([
    ['AC', 'AC'],
    ['WA', 'WA'],
    ['PE', 'WA'],
    ['TLE', 'TLE'],
    ['TIMEOUT', 'TLE'],
    ['MLE', 'MLE'],
    ['OLE', 'OLE'],
    ['RE', 'RTE'],
    ['RTE', 'RTE'],
    ['IR', 'IR'],
  ])('grades remote %s as one %s case', (remote, status) => {
    const outcome = mapExternalResult(
      finished({ statusCanonical: remote, runtimeMs: 1500, memoryKb: 2048 }),
      ALL_OR_NOTHING,
    );
    expect(outcome).toEqual({
      kind: 'graded',
      testCase: {
        status,
        time: 1.5,
        memory: 2048,
        points: status === 'AC' ? 100 : 0,
        total: 100,
        feedback: '',
      },
    });
  });

  it('reads the canonical status in any case and spelling, also nested in rawVjudgeStatus', () => {
    const nested = finished({
      rawVjudgeStatus: { statusCanonical: 'time-limit' },
    });
    expect(nested.statusCanonical).toBe('TIME_LIMIT');
    expect(
      mapExternalResult(finished({ statusCanonical: ' wa ' }), PARTIAL),
    ).toMatchObject({
      testCase: { status: 'WA' },
    });
  });

  it('turns a full score into AC whatever the verdict', () => {
    expect(
      mapExternalResult(
        finished({ statusCanonical: 'WA', scoreText: '100/100' }),
        ALL_OR_NOTHING,
      ),
    ).toMatchObject({
      kind: 'graded',
      testCase: { status: 'AC', points: 100 },
    });
  });

  it('gives proportional points on a partial problem only', () => {
    const run = finished({ statusCanonical: 'WA', scoreText: '37 / 50' });
    expect(mapExternalResult(run, PARTIAL)).toMatchObject({
      testCase: { status: 'WA', points: 74, feedback: '37 / 50' },
    });
    expect(mapExternalResult(run, ALL_OR_NOTHING)).toMatchObject({
      testCase: { status: 'WA', points: 0 },
    });
  });

  it('makes a scored CE or IE a WA on a partial problem, and keeps it otherwise', () => {
    const compileError = finished({
      statusCanonical: 'CE',
      scoreText: '40',
      errorMessage: 'log',
    });
    expect(mapExternalResult(compileError, PARTIAL)).toMatchObject({
      kind: 'graded',
      testCase: { status: 'WA', points: 40 },
    });
    expect(mapExternalResult(compileError, ALL_OR_NOTHING)).toEqual({
      kind: 'compile-error',
      log: 'log',
    });
    expect(
      mapExternalResult(finished({ statusCanonical: 'IE' }), ALL_OR_NOTHING),
    ).toMatchObject({
      kind: 'internal-error',
    });
  });

  it('ends an unknown final status as an internal error', () => {
    expect(
      mapExternalResult(finished({ statusCanonical: 'WEIRD' }), PARTIAL),
    ).toEqual({
      kind: 'internal-error',
      message: UNSUPPORTED_STATUS_MESSAGE,
    });
  });

  it('ends a refused submit as an internal error, even while processing', () => {
    expect(
      mapExternalResult(
        remoteRunOf({ systemStatus: 'submit_failed' }),
        PARTIAL,
      ),
    ).toEqual({ kind: 'internal-error', message: SUBMIT_FAILED_MESSAGE });
    expect(
      mapExternalResult(
        remoteRunOf({
          statusCanonical: 'SUBMIT_FAILED_LOGIN',
          errorMessage: 'no account',
          processing: true,
        }),
        PARTIAL,
      ),
    ).toEqual({ kind: 'internal-error', message: 'no account' });
  });
});

describe('isProcessing', () => {
  it.each([
    ['no processing flag', { systemStatus: 'done', statusCanonical: 'AC' }],
    [
      'processing true',
      { processing: true, systemStatus: 'done', statusCanonical: 'AC' },
    ],
    ['empty system status', { processing: false, statusCanonical: 'AC' }],
    [
      'a queued system status',
      { processing: false, systemStatus: 'Queued', statusCanonical: 'AC' },
    ],
    [
      'a pending canonical',
      { processing: false, systemStatus: 'done', statusCanonical: 'PENDING' },
    ],
  ])('keeps polling with %s', (_label, fields) => {
    expect(isProcessing(remoteRunOf(fields))).toBe(true);
    expect(mapExternalResult(remoteRunOf(fields), PARTIAL)).toEqual({
      kind: 'processing',
    });
  });

  it('is final once processing is false with a final status', () => {
    expect(isProcessing(finished({ statusCanonical: 'AC' }))).toBe(false);
  });
});

describe('scorePercent', () => {
  it.each([
    ['30/40', 75],
    ['score: 12.5 / 50 pts', 25],
    ['85', 85],
    ['85.5 points', 85.5],
    ['150', 100],
    ['-3', 0],
    ['5/0', null],
    ['n/a', null],
    [null, null],
  ])('reads %p as %p', (text, percent) => {
    expect(scorePercent(text)).toBe(percent);
  });
});
