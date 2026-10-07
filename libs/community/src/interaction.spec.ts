import {
  canInteract,
  hasEnoughSolves,
  officialContestLocks,
} from './interaction';

const user = (
  fields: Partial<{
    isStaff: boolean;
    isSuperuser: boolean;
    problemCount: number;
    mute: boolean;
  }>,
) => ({
  isStaff: false,
  isSuperuser: false,
  problemCount: 0,
  mute: false,
  ...fields,
});

describe('interaction gate', () => {
  it('needs five solved problems unless staff or superuser', () => {
    expect(hasEnoughSolves(user({ problemCount: 4 }))).toBe(false);
    expect(hasEnoughSolves(user({ problemCount: 5 }))).toBe(true);
    expect(hasEnoughSolves(user({ isStaff: true }))).toBe(true);
    expect(hasEnoughSolves(user({ isSuperuser: true }))).toBe(true);
  });

  it('refuses muted users whatever they solved', () => {
    expect(canInteract(user({ problemCount: 500, mute: true }))).toBe(false);
    expect(canInteract(user({ isStaff: true, mute: true }))).toBe(false);
    expect(canInteract(user({ problemCount: 5 }))).toBe(true);
    expect(canInteract(user({ isSuperuser: true }))).toBe(true);
  });
});

describe('officialContestLocks', () => {
  it('locks everyone but superusers while the mode is on', () => {
    expect(officialContestLocks(true, null)).toBe(true);
    expect(officialContestLocks(true, { isSuperuser: false })).toBe(true);
    expect(officialContestLocks(true, { isSuperuser: true })).toBe(false);
    expect(officialContestLocks(false, { isSuperuser: false })).toBe(false);
  });
});
