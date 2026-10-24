import { Status } from '@libs/judge-proto';
import type { Case } from '@libs/judge-proto';

export type FakeVerdict = 'AC' | 'WA';

export const verdictFor = (
  source: string,
  wrongAnswerMarker: string,
): FakeVerdict =>
  wrongAnswerMarker && source.includes(wrongAnswerMarker) ? 'WA' : 'AC';

/** CaseResults entries for `count` cases (1-based positions), all with the verdict's status. */
export const casesFor = (count: number, verdict: FakeVerdict): Case[] =>
  Array.from({ length: count }, (_unused, index) => ({
    position: index + 1,
    status: verdict === 'AC' ? Status.STATUS_AC : Status.STATUS_WA,
    timeS: 0.01,
    juryTimeS: 0,
    memoryKib: 1024,
    points: verdict === 'AC' ? 1 : 0,
    total: 1,
    batch: 0,
    feedback: '',
    extendedFeedback: '',
    outputPrefix: '',
  }));
