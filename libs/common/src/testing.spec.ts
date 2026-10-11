import { redisUrlForWorker } from './testing';

describe('redisUrlForWorker', () => {
  it.each([
    ['redis://127.0.0.1:6379/15', '1', 'redis://127.0.0.1:6379/15'],
    ['redis://localhost:6391/20', '3', 'redis://localhost:6391/22'],
    ['redis://localhost:6379', '3', 'redis://localhost:6379/2'],
  ])('%s worker %s -> %s', (base, worker, expected) => {
    expect(redisUrlForWorker(base, worker)).toBe(expected);
  });
});
