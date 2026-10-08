import { removedEnvInUse } from './removed-env';

describe('removedEnvInUse', () => {
  it('names the moved variables that are still set', () => {
    expect(
      removedEnvInUse({
        SMTP_URL: 'smtp://x',
        GOOGLE_CLIENT_ID: 'id',
        OFFICIAL_CONTEST_MODE: 'true',
        MONGO_URL: 'mongodb://x',
        MAIL_FROM: '',
      }).sort(),
    ).toEqual(['GOOGLE_CLIENT_ID', 'OFFICIAL_CONTEST_MODE', 'SMTP_URL']);
  });
  it('is empty for a clean environment', () => {
    expect(removedEnvInUse({ MONGO_URL: 'x', MOSS_API_KEY: '1' })).toEqual([]);
  });
});
