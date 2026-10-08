import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Type } from '@nestjs/common';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { hashPassword, SessionService } from '@libs/auth';
import { MAILER, REDIS } from '@libs/common';
import { createTestApp, InMemoryMailer, TEST_ENV } from '@libs/common/testing';
import {
  Contest,
  ContestAnnouncement,
  ContestMoss,
  ContestOfficialRanking,
  ContestParticipation,
  ContestPublicRankingLink,
  ContestSubmission,
  Group,
  Judge,
  Language,
  License,
  BlogPost,
  BlogVote,
  Comment,
  CommentLock,
  CommentVote,
  Organization,
  OrganizationRequest,
  Problem,
  ProblemGroup,
  ProblemType,
  Rating,
  Revision,
  Submission,
  SubmissionSource,
  Tag,
  TagGroup,
  TagProblem,
  User,
} from '@libs/database';
import { startMongo } from '@libs/database/testing';
import { SettingsService } from '@libs/settings';
import type { SettingKey } from '@libs/settings';
import Redis from 'ioredis';
import type { Connection, Model } from 'mongoose';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { LanguagesQuerier } from '../src/modules/problems/catalog/languages.querier';
import { LicensesQuerier } from '../src/modules/problems/catalog/licenses.querier';
import { ProblemGroupsQuerier } from '../src/modules/problems/catalog/problem-groups.querier';
import { ProblemTypesQuerier } from '../src/modules/problems/catalog/problem-types.querier';
import { TagGroupsQuerier } from '../src/modules/tags/tag-groups.querier';
import { TagsQuerier } from '../src/modules/tags/tags.querier';
import { setupOpenApi } from '../src/openapi';

export { TEST_ENV };

export async function setupApiTest({
  controllers = [],
  overrides = [],
  env = {},
}: {
  controllers?: Type[];
  overrides?: Array<{ provide: unknown; useValue: unknown }>;
  /** Extra environment variables, applied after the defaults. */
  env?: Record<string, string>;
} = {}) {
  const mailer = new InMemoryMailer();
  const replSet = await startMongo();
  const mediaRoot = mkdtempSync(join(tmpdir(), 'qhhoj-media-'));
  const problemDataRoot = mkdtempSync(join(tmpdir(), 'qhhoj-problem-data-'));
  const pdfCacheRoot = mkdtempSync(join(tmpdir(), 'qhhoj-pdf-cache-'));
  const contestDataRoot = mkdtempSync(join(tmpdir(), 'qhhoj-contest-data-'));
  const userDataRoot = mkdtempSync(join(tmpdir(), 'qhhoj-user-data-'));
  const removeRoots = () =>
    [
      mediaRoot,
      problemDataRoot,
      pdfCacheRoot,
      contestDataRoot,
      userDataRoot,
    ].forEach((root) => rmSync(root, { recursive: true, force: true }));
  Object.assign(process.env, TEST_ENV, {
    MONGO_URL: replSet.getUri('qhhoj'),
    MEDIA_ROOT: mediaRoot,
    PROBLEM_DATA_ROOT: problemDataRoot,
    PDF_CACHE_ROOT: pdfCacheRoot,
    CONTEST_DATA_ROOT: contestDataRoot,
    USER_DATA_ROOT: userDataRoot,
    OFFICIAL_CONTEST_MODE: 'false',
    DISCORD_WEBHOOK_URLS: '',
    MOSS_API_KEY: '',
    ...env,
  });
  let app: NestFastifyApplication | undefined;
  try {
    app = await createTestApp(
      { imports: [AppModule], controllers },
      {
        beforeInit: setupOpenApi,
        overrides: [{ provide: MAILER, useValue: mailer }, ...overrides],
      },
    );
    await app.listen(0, '127.0.0.1');
    await app.get<Redis>(REDIS).flushdb();
    await app.get(SettingsService).set('auth.pwnedApiUrl', '', null);
    // Queries that `.hint()` an index fail until its build finishes.
    const connection = app.get<Connection>(getConnectionToken());
    await Promise.all(
      Object.values(connection.models).map((model) => model.init()),
    );
  } catch (error) {
    try {
      await app?.close();
    } finally {
      await replSet.stop();
      removeRoots();
    }
    throw error;
  }
  const readyApp = app;
  return {
    app: readyApp,
    http: () => request(readyApp.getHttpServer()),
    users: readyApp.get<Model<User>>(getModelToken(User.name)),
    groups: readyApp.get<Model<Group>>(getModelToken(Group.name)),
    problemTypes: readyApp.get<Model<ProblemType>>(
      getModelToken(ProblemType.name),
    ),
    problemGroups: readyApp.get<Model<ProblemGroup>>(
      getModelToken(ProblemGroup.name),
    ),
    problems: readyApp.get<Model<Problem>>(getModelToken(Problem.name)),
    revisions: readyApp.get<Model<Revision>>(getModelToken(Revision.name)),
    licenses: readyApp.get<Model<License>>(getModelToken(License.name)),
    tagGroups: readyApp.get<Model<TagGroup>>(getModelToken(TagGroup.name)),
    tags: readyApp.get<Model<Tag>>(getModelToken(Tag.name)),
    tagProblems: readyApp.get<Model<TagProblem>>(
      getModelToken(TagProblem.name),
    ),
    languages: readyApp.get<Model<Language>>(getModelToken(Language.name)),
    judges: readyApp.get<Model<Judge>>(getModelToken(Judge.name)),
    submissions: readyApp.get<Model<Submission>>(
      getModelToken(Submission.name),
    ),
    submissionSources: readyApp.get<Model<SubmissionSource>>(
      getModelToken(SubmissionSource.name),
    ),
    contests: readyApp.get<Model<Contest>>(getModelToken(Contest.name)),
    participations: readyApp.get<Model<ContestParticipation>>(
      getModelToken(ContestParticipation.name),
    ),
    contestSubmissions: readyApp.get<Model<ContestSubmission>>(
      getModelToken(ContestSubmission.name),
    ),
    ratings: readyApp.get<Model<Rating>>(getModelToken(Rating.name)),
    contestMoss: readyApp.get<Model<ContestMoss>>(
      getModelToken(ContestMoss.name),
    ),
    announcements: readyApp.get<Model<ContestAnnouncement>>(
      getModelToken(ContestAnnouncement.name),
    ),
    rankingLinks: readyApp.get<Model<ContestPublicRankingLink>>(
      getModelToken(ContestPublicRankingLink.name),
    ),
    officialRankings: readyApp.get<Model<ContestOfficialRanking>>(
      getModelToken(ContestOfficialRanking.name),
    ),
    organizations: readyApp.get<Model<Organization>>(
      getModelToken(Organization.name),
    ),
    organizationRequests: readyApp.get<Model<OrganizationRequest>>(
      getModelToken(OrganizationRequest.name),
    ),
    blogPosts: readyApp.get<Model<BlogPost>>(getModelToken(BlogPost.name)),
    blogVotes: readyApp.get<Model<BlogVote>>(getModelToken(BlogVote.name)),
    comments: readyApp.get<Model<Comment>>(getModelToken(Comment.name)),
    commentVotes: readyApp.get<Model<CommentVote>>(
      getModelToken(CommentVote.name),
    ),
    commentLocks: readyApp.get<Model<CommentLock>>(
      getModelToken(CommentLock.name),
    ),
    db: readyApp.get<Connection>(getConnectionToken()).db!,
    /** Streams are disabled in tests; call after inserting catalog rows. */
    resyncCatalog: async () => {
      await Promise.all(
        [
          ProblemTypesQuerier,
          ProblemGroupsQuerier,
          LicensesQuerier,
          LanguagesQuerier,
          TagGroupsQuerier,
          TagsQuerier,
        ].map((querier) => readyApp.get(querier).resync()),
      );
    },
    mediaRoot,
    problemDataRoot,
    pdfCacheRoot,
    contestDataRoot,
    userDataRoot,
    sessions: readyApp.get(SessionService),
    mailer,
    /** Writes through the real service, so readers see it at once. */
    setSetting: (key: SettingKey, value: unknown) =>
      readyApp.get(SettingsService).set(key, value, null),
    teardown: async () => {
      await readyApp.close();
      await replSet.stop();
      removeRoots();
    },
  };
}

export type ApiTest = Awaited<ReturnType<typeof setupApiTest>>;

/** Fast hash (1000 iterations) unless a test needs real cost; `needsRehash` will upgrade it on login. */
export const createUser = async (
  users: Model<User>,
  {
    password = 'correct horse battery',
    ...fields
  }: Partial<User> & { password?: string },
) =>
  users.create({
    username: 'alice',
    email: 'alice@example.com',
    isActive: true,
    ...fields,
    password: await hashPassword(password, 1000),
  });

export const sessionCookie = (id: string) => `qhhoj_session=${id}`;

export const errorCode =
  (code: string) =>
  ({ body }: { body: { error: { code: string } } }) =>
    expect(body.error.code).toBe(code);
