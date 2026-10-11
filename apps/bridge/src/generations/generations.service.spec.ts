import { COMPILE_FEATURE, GENERATE_FEATURE } from '@libs/judging';
import type { GenerationFeature } from '@libs/judging';
import { pickGeneration } from './generations.service';

const queue = (...rows: [string, GenerationFeature][]) => new Map(rows);

describe('pickGeneration', () => {
  const both = queue(
    ['compile-1', COMPILE_FEATURE],
    ['polygon-1', GENERATE_FEATURE],
  );

  it('never gives a compile check to a judge that only generates tests', () => {
    expect(pickGeneration(both, new Set([GENERATE_FEATURE]))).toBe('polygon-1');
    expect(
      pickGeneration(
        queue(['compile-1', COMPILE_FEATURE]),
        new Set([GENERATE_FEATURE]),
      ),
    ).toBeUndefined();
  });

  it('takes the oldest row the judge can run', () => {
    const judge = new Set([GENERATE_FEATURE, COMPILE_FEATURE]);
    expect(pickGeneration(both, judge)).toBe('compile-1');
    expect(
      pickGeneration(
        queue(['polygon-1', GENERATE_FEATURE], ['compile-1', COMPILE_FEATURE]),
        judge,
      ),
    ).toBe('polygon-1');
  });

  it('gives nothing to a judge without generation features', () => {
    expect(pickGeneration(both, new Set())).toBeUndefined();
  });
});
