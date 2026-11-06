import { windowName } from './window-name';

describe('windowName', () => {
  it.each([
    [60, 'minute'],
    [3600, 'hour'],
    [86_400, 'day'],
    [900, '900 seconds'],
  ])('%i seconds reads as %s', (seconds, name) =>
    expect(windowName(seconds)).toBe(name),
  );
});
