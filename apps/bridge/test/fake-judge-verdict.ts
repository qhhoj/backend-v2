export type FakeVerdict = 'AC' | 'WA';

const STATUS = { AC: 0, WA: 1 } as const;

export const verdictFor = (
  source: string,
  wrongAnswerMarker: string,
): FakeVerdict =>
  wrongAnswerMarker && source.includes(wrongAnswerMarker) ? 'WA' : 'AC';

/** `test-case-status` entries for `count` cases (1-based positions), all with the verdict's status. */
export const casesFor = (count: number, verdict: FakeVerdict) =>
  Array.from({ length: count }, (_unused, index) => ({
    position: index + 1,
    status: STATUS[verdict],
    time: 0.01,
    memory: 1024,
    points: verdict === 'AC' ? 1 : 0,
    'total-points': 1,
    feedback: '',
    'extended-feedback': '',
    output: '',
  }));
