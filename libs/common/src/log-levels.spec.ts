import { nestLogLevels } from './log-levels';

describe('nestLogLevels', () => {
  it('enables every level at trace', () => {
    expect(nestLogLevels('trace')).toEqual([
      'fatal',
      'error',
      'warn',
      'log',
      'debug',
      'verbose',
    ]);
  });

  it('keeps only more severe levels at warn', () => {
    expect(nestLogLevels('warn')).toEqual(['fatal', 'error', 'warn']);
  });

  it('prints nothing when silent', () => {
    expect(nestLogLevels('silent')).toEqual([]);
  });
});
