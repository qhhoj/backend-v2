import { nestLogLevels } from './log-levels';

describe('nestLogLevels', () => {
  it('enables every level at or above the configured severity', () => {
    expect(nestLogLevels('info')).toEqual(['fatal', 'error', 'warn', 'log']);
    expect(nestLogLevels('error')).toEqual(['fatal', 'error']);
  });
  it('is silent for silent and a superset for more verbose levels', () => {
    expect(nestLogLevels('silent')).toEqual([]);
    expect(nestLogLevels('trace')).toEqual(
      expect.arrayContaining(nestLogLevels('debug')),
    );
    expect(nestLogLevels('trace').length).toBeGreaterThan(
      nestLogLevels('debug').length,
    );
  });
});
