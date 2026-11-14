import { randomBytes } from 'node:crypto';
import { MongoClient } from 'mongodb';
import type { Db } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import * as schemas from './schemas';
import { SCHEMAS } from './schemas/models';
import { SNAPSHOT_LOAD_COMMENT } from './snapshot-load';

/** Set by `test/jest/global-setup.js`: the run's one replica set, with `__DB__` where the database name goes. */
const SHARED_MONGO_URI = 'QHHOJ_TEST_MONGO_URI';

export interface TestMongo {
  /** A database of this handle's own: no other test file (or jest worker) ever sees it. */
  getUri(database?: string): string;
  stop(): Promise<unknown>;
}

const startOwnReplSet = () =>
  MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });

/**
 * Databases of their own on the run's shared replica set (one mongod per jest run instead of one per file); `stop()` drops them.
 * Without the global setup (a config that skips it) it starts a replica set of its own, as before.
 */
export async function startMongo(): Promise<TestMongo> {
  const template = process.env[SHARED_MONGO_URI];
  if (!template) return startOwnReplSet();
  const prefix = `w${process.env.JEST_WORKER_ID ?? '1'}_${randomBytes(4).toString('hex')}`;
  const names = new Set<string>();
  const getUri = (database = 'test') => {
    const name = `${prefix}_${database}`;
    names.add(name);
    return template.replace('__DB__', name);
  };
  return {
    getUri,
    stop: async () => {
      const client = await MongoClient.connect(template.replace('__DB__', ''));
      try {
        for (const name of names) await client.db(name).dropDatabase();
      } finally {
        await client.close();
      }
    },
  };
}

export interface ProfiledOperation {
  collection: string;
  operation: string;
  /** `COLLSCAN` means no index was used. */
  planSummary: string;
  docsExamined: number;
  /** Index entries read; a regex that cannot bound its scan shows here, not in `docsExamined`. */
  keysExamined: number;
  /** True when the server sorted in memory (`planSummary` lists only index scans, never a SORT stage). */
  hasSortStage: boolean;
}

/**
 * Runs `work` with the database profiler on and returns every operation the server saw: index assertions observe what Mongo did, not the query text.
 * One allowance: a querier's snapshot load (`loadAll`, tagged `SNAPSHOT_LOAD_COMMENT`) is dropped. It scans a tiny registry on purpose and its
 * resync cron (settings every minute) can fire inside any window, so keeping it would fail index tests by wall-clock chance.
 */
export async function profileQueries(
  db: Db,
  work: () => Promise<unknown>,
): Promise<ProfiledOperation[]> {
  await db.command({ profile: 0 });
  await db
    .collection('system.profile')
    .drop()
    .catch(() => undefined);
  // The default 1 MB profile evicts the large entries of a bulk read.
  await db.createCollection('system.profile', {
    capped: true,
    size: 64 * 1024 * 1024,
  });
  await db.command({ profile: 2 });
  try {
    await work();
  } finally {
    await db.command({ profile: 0 });
  }
  const entries = await db.collection('system.profile').find({}).toArray();
  return entries
    .filter(
      (entry) =>
        (entry.command as { comment?: unknown } | undefined)?.comment !==
        SNAPSHOT_LOAD_COMMENT,
    )
    .map((entry) => ({
      collection: String(entry.ns).slice(db.databaseName.length + 1),
      operation: String(entry.op),
      planSummary: String(entry.planSummary ?? ''),
      docsExamined: Number(entry.docsExamined ?? 0),
      keysExamined: Number(entry.keysExamined ?? 0),
      hasSortStage: Boolean(entry.hasSortStage),
    }));
}

/**
 * The name every spec setup gives each model: the collection's, or the shorter name specs already use. A model
 * `SCHEMAS` registers and this table leaves out fails every setup (`modelsOf`).
 */
const MODEL_ACCESSORS = {
  activationKeys: schemas.ActivationKey,
  announcements: schemas.ContestAnnouncement,
  balloonDeliveries: schemas.ContestBalloon,
  blogPosts: schemas.BlogPost,
  blogVotes: schemas.BlogVote,
  commentLocks: schemas.CommentLock,
  commentPageCounters: schemas.CommentPageCounter,
  commentReports: schemas.CommentReport,
  commentVotes: schemas.CommentVote,
  comments: schemas.Comment,
  contestSubmissions: schemas.ContestSubmission,
  contestTags: schemas.ContestTag,
  contests: schemas.Contest,
  externalRuns: schemas.ExternalRun,
  feedKeys: schemas.ContestFeedKey,
  flatpages: schemas.Flatpage,
  generalIssues: schemas.GeneralIssue,
  ghosts: schemas.ContestGhost,
  groups: schemas.Group,
  integrationClients: schemas.IntegrationClient,
  judges: schemas.Judge,
  languages: schemas.Language,
  licenses: schemas.License,
  migrations: schemas.MigrationRecord,
  miscConfigs: schemas.MiscConfig,
  notifications: schemas.Notification,
  officialRankings: schemas.ContestOfficialRanking,
  organizationCreditEntries: schemas.OrganizationCreditEntry,
  organizationJudgingCharges: schemas.OrganizationJudgingCharge,
  organizationProblemTags: schemas.OrganizationProblemTag,
  organizationProblems: schemas.OrganizationProblem,
  organizationRequests: schemas.OrganizationRequest,
  organizationUsage: schemas.OrganizationUsage,
  organizations: schemas.Organization,
  participations: schemas.ContestParticipation,
  polygonSyncRuns: schemas.PolygonSyncRun,
  problemGroups: schemas.ProblemGroup,
  problemTypes: schemas.ProblemType,
  problems: schemas.Problem,
  rankingLinks: schemas.ContestPublicRankingLink,
  ratings: schemas.Rating,
  replayChunks: schemas.ContestReplayChunk,
  replayHeads: schemas.ContestReplayHead,
  revisions: schemas.Revision,
  settingRevisions: schemas.SettingRevision,
  settings: schemas.Setting,
  shareReports: schemas.ShareReport,
  shares: schemas.Share,
  shortLinks: schemas.ShortLink,
  similarityPairs: schemas.SimilarityPair,
  similarityRuns: schemas.SimilarityRun,
  submissionSources: schemas.SubmissionSource,
  submissions: schemas.Submission,
  tagGroups: schemas.TagGroup,
  tagProblems: schemas.TagProblem,
  tags: schemas.Tag,
  testGenerations: schemas.TestGeneration,
  ticketCannedReplies: schemas.TicketCannedReply,
  tickets: schemas.Ticket,
  userActivities: schemas.UserActivity,
  userSessions: schemas.UserSession,
  users: schemas.User,
};
type ModelAccessors = {
  [Name in keyof typeof MODEL_ACCESSORS]: Model<
    InstanceType<(typeof MODEL_ACCESSORS)[Name]>
  >;
};

/** Every model of the app under test, by its accessor name. */
export function modelsOf(app: { get<T>(token: string): T }): ModelAccessors {
  const named = new Set(Object.values(MODEL_ACCESSORS).map(({ name }) => name));
  const missing = SCHEMAS.filter(({ name }) => !named.has(name));
  if (missing.length)
    throw new Error(
      `MODEL_ACCESSORS lacks ${missing.map(({ name }) => name).join(', ')}`,
    );
  return Object.fromEntries(
    Object.entries(MODEL_ACCESSORS).map(([accessor, { name }]) => [
      accessor,
      app.get(getModelToken(name)),
    ]),
  ) as ModelAccessors;
}
