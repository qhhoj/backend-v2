export interface PasswordProblem {
  code: string;
  message: string;
}

export const PWNED_PASSWORD_PROBLEM: PasswordProblem = {
  code: 'password_pwned',
  message: 'This password has appeared in a data breach.',
};

export function passwordProblems(
  password: string,
  owner: { username: string; email: string },
): PasswordProblem[] {
  const lowered = password.toLowerCase();
  const identities = [owner.username, owner.email.split('@')[0]]
    .filter((identity) => identity.length >= 3)
    .map((identity) => identity.toLowerCase());
  return [
    password.length < 8 && {
      code: 'password_too_short',
      message: 'Password must be at least 8 characters.',
    },
    /^\d+$/.test(password) && {
      code: 'password_numeric',
      message: 'Password cannot be entirely numeric.',
    },
    identities.some((identity) => lowered.includes(identity)) && {
      code: 'password_similar_to_identity',
      message: 'Password is too similar to your username or email.',
    },
  ].filter((problem): problem is PasswordProblem => problem !== false);
}
