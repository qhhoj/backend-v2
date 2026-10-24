import { SessionRecords } from './session-record';

describe('SessionRecords', () => {
  it('refuses a secret under 32 bytes', () => {
    expect(() => new SessionRecords('é'.repeat(15))).toThrow(
      'SESSION_SECRET must be at least 32 bytes',
    );
    expect(() => new SessionRecords('')).toThrow(/SESSION_SECRET/);
    expect(() => new SessionRecords('é'.repeat(16))).not.toThrow();
  });
});
