import { indexBuildFailure } from './build-indexes';

describe('indexBuildFailure', () => {
  it('names the collection, index and code of a duplicate-key build without the duplicated value', () => {
    const error = Object.assign(
      new Error(
        'Index build failed: 4f1e: Collection qhhoj.users :: caused by :: E11000 duplicate key error collection: qhhoj.users index: socialAuth.uid_1 dup key: { socialAuth.uid: "secret-uid-42" }',
      ),
      { code: 11000, codeName: 'DuplicateKey' },
    );
    const text = indexBuildFailure('users', error);
    expect(text).toBe(
      'index build failed on users, index socialAuth.uid_1: DuplicateKey (code 11000)',
    );
    expect(text).not.toContain('secret-uid-42');
  });
});
