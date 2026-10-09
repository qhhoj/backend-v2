import { meterOf } from './quota-meter';

describe('meterOf', () => {
  it('flags 80 percent and over', () => {
    expect(meterOf(79, 100)).toMatchObject({
      isNearLimit: false,
      isOver: false,
    });
    expect(meterOf(80, 100)).toMatchObject({
      isNearLimit: true,
      isOver: false,
    });
    expect(meterOf(100, 100)).toMatchObject({
      isNearLimit: true,
      isOver: false,
    });
    expect(meterOf(101, 100)).toMatchObject({
      isNearLimit: true,
      isOver: true,
    });
  });
  it('treats a zero limit as full as soon as anything is used', () => {
    expect(meterOf(0, 0)).toMatchObject({ isNearLimit: true, isOver: true });
    expect(meterOf(1, 0)).toMatchObject({ isNearLimit: true, isOver: true });
  });
});
