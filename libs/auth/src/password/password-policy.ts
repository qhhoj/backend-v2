export function passwordProblems(
  password: string,
  owner: { username: string; email: string },
): string[] {
  const lowered = password.toLowerCase();
  const identities = [owner.username, owner.email.split('@')[0]]
    .filter((identity) => identity.length >= 3)
    .map((identity) => identity.toLowerCase());
  return [
    password.length < 8 && 'Password must be at least 8 characters.',
    /^\d+$/.test(password) && 'Password cannot be entirely numeric.',
    identities.some((identity) => lowered.includes(identity)) &&
      'Password is too similar to your username or email.',
  ].filter((problem): problem is string => typeof problem === 'string');
}
