import { MessageRate } from './message-rate';

describe('MessageRate', () => {
  let clock = 0;
  const rate = () => new MessageRate(1000, () => clock);
  const admitMany = (limiter: MessageRate, count: number) =>
    Array.from({ length: count }, () => limiter.admit());

  beforeEach(() => {
    clock = 10_000;
  });

  it('admits 1000 messages in a second and refuses the 1001st', () => {
    const limiter = rate();
    expect(admitMany(limiter, 1000).every(Boolean)).toBe(true);
    clock += 999;
    expect(limiter.admit()).toBe(false);
  });

  it('refuses a burst that straddles any one-second edge', () => {
    const limiter = rate();
    admitMany(limiter, 600);
    clock += 950;
    const second = admitMany(limiter, 500);
    expect(second.slice(0, 400).every(Boolean)).toBe(true);
    expect(second[400]).toBe(false);
  });

  it('admits a steady stream at the rate for ever', () => {
    const limiter = rate();
    for (let tick = 0; tick < 5000; tick += 1) {
      expect(limiter.admit()).toBe(true);
      clock += 1;
    }
  });

  it('admits the 1001st message once the first is a second old', () => {
    const limiter = rate();
    admitMany(limiter, 1000);
    clock += 1000;
    expect(limiter.admit()).toBe(true);
  });
});
