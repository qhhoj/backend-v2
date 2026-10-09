import { redisUrlForWorker } from './testing';

describe('redisUrlForWorker', () => {
  it('keeps the base db for worker 1', () => {
    expect(redisUrlForWorker('redis://127.0.0.1:6379/15', '1')).toBe(
      'redis://127.0.0.1:6379/15',
    );
  });

  it('gives each worker its own db above the base', () => {
    const dbs = ['1', '2', '3'].map(
      (id) =>
        new URL(redisUrlForWorker('redis://localhost:6391/20', id)).pathname,
    );
    expect(dbs).toEqual(['/20', '/21', '/22']);
  });

  it('treats a url without a db as db 0', () => {
    expect(redisUrlForWorker('redis://localhost:6379', '3')).toBe(
      'redis://localhost:6379/2',
    );
  });
});
