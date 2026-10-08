import { passwordProblems } from './password-policy';

const owner = { username: 'alice', email: 'alice.smith@example.com' };

describe('passwordProblems', () => {
  it('accepts a good password', () =>
    expect(passwordProblems('correct horse battery', owner)).toEqual([]));
  it.each([
    ['short1', 'Password must be at least 8 characters.'],
    ['1234567890', 'Password cannot be entirely numeric.'],
    ['ALICE-2024!', 'Password is too similar to your username or email.'],
    ['my alice.smith pw', 'Password is too similar to your username or email.'],
  ])('rejects %s', (password, problem) =>
    expect(
      passwordProblems(password, owner).map(({ message }) => message),
    ).toContain(problem),
  );
  it('names each problem with a machine code', () =>
    expect(
      [
        ...passwordProblems('short1', owner),
        ...passwordProblems('1234567890', owner),
        ...passwordProblems('ALICE-2024!', owner),
      ].map(({ code }) => code),
    ).toEqual([
      'password_too_short',
      'password_numeric',
      'password_similar_to_identity',
    ]));
});
