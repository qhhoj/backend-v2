import { meterOf } from './quota-meter';

describe('meterOf', () => {
  it.each([
    [79, 100, false, false],
    [80, 100, true, false],
    [100, 100, true, false],
    [101, 100, true, true],
    [0, 0, true, true],
  ])('%i of %i', (used, limit, isNearLimit, isOver) =>
    expect(meterOf(used, limit)).toMatchObject({ isNearLimit, isOver }),
  );
});
