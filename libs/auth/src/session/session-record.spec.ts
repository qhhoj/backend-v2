import { SessionRecords } from './session-record';

describe('SessionRecords', () => {
  it('refuses a missing or short secret at construction', () => {
    expect(() => new SessionRecords(undefined as unknown as string)).toThrow(
      'SESSION_SECRET must be at least 32 bytes',
    );
    expect(() => new SessionRecords('short')).toThrow();
    expect(() => new SessionRecords('s'.repeat(32))).not.toThrow();
  });
});
