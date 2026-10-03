import type { User } from '@libs/database';
import type { Test as SupertestRequest } from 'supertest';
import { ApiTest, createUser, sessionCookie } from './setup';

export type Catalog = Awaited<ReturnType<typeof seedCatalog>>;
export interface TestSession {
  cookie: string;
  csrf: string;
}

export async function seedCatalog(api: ApiTest) {
  const [uncategorizedType, dpType] = await api.problemTypes.create([
    { name: 'uncategorized', fullName: 'Uncategorized' },
    { name: 'dp', fullName: 'Dynamic Programming' },
  ]);
  const [uncategorizedGroup, voiGroup] = await api.problemGroups.create([
    { name: 'Uncategorized', fullName: 'Uncategorized' },
    { name: 'VOI', fullName: 'VOI' },
  ]);
  const [mit] = await api.licenses.create([
    {
      key: 'mit',
      name: 'MIT License',
      link: 'https://opensource.org/licenses/MIT',
    },
  ]);
  const [cpp, python, text] = await api.languages.create([
    {
      key: 'CPP17',
      name: 'C++17',
      commonName: 'C++',
      ace: 'c_cpp',
      pygments: 'cpp',
      extension: 'cpp',
      includeInProblem: true,
    },
    {
      key: 'PY3',
      name: 'Python 3',
      commonName: 'Python',
      ace: 'python',
      pygments: 'python3',
      extension: 'py',
      includeInProblem: true,
    },
    {
      key: 'TEXT',
      name: 'Text',
      commonName: 'Text',
      ace: 'text',
      pygments: 'text',
      extension: 'txt',
    },
  ]);
  await api.resyncCatalog();
  return {
    types: { uncategorized: uncategorizedType._id, dp: dpType._id },
    groups: { uncategorized: uncategorizedGroup._id, voi: voiGroup._id },
    licenses: { mit: mit._id },
    languages: { cpp: cpp._id, python: python._id, text: text._id },
  };
}

/** A ready session straight in Redis (no HTTP login); `flags` can leave 2FA pending. */
export async function loginAs(
  api: ApiTest,
  userId: string,
  flags: Partial<{ twoFaPassed: boolean }> = {},
): Promise<TestSession> {
  const { id, session } = await api.sessions.create({
    userId,
    twoFaPassed: true,
    passwordPwned: false,
    impersonatorId: null,
    ...flags,
  });
  return { cookie: sessionCookie(id), csrf: session.csrf };
}

export const authed = (request: SupertestRequest, session: TestSession) =>
  request.set('Cookie', session.cookie).set('X-CSRF-Token', session.csrf);

export const createUserWith = (
  api: ApiTest,
  username: string,
  extra: Partial<User> = {},
) =>
  createUser(api.users, {
    username,
    email: `${username}@example.com`,
    ...extra,
  });
