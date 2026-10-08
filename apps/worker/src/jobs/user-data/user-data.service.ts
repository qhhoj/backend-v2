import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { ENV } from '@libs/common';
import type { Env } from '@libs/common';
import {
  isUserDataExpired,
  userDataPath,
  userDataTempPath,
} from '@libs/community';
import { chunkedSources, writeZipInPlace } from '../lazy-zip';
import type { ZipLimits } from '../lazy-zip';
import { UserDataCommunityRepository } from './user-data-community.repository';
import { UserDataRepository } from './user-data.repository';
import type {
  UserDataComment,
  UserDataPost,
} from './user-data-community.repository';
import type { UserDataSubmission } from './user-data.repository';

export type UserDataLimits = ZipLimits;
export const USER_DATA_LIMITS = Symbol('USER_DATA_LIMITS');
export const DEFAULT_USER_DATA_LIMITS: UserDataLimits = {
  maxBytes: 256 * 1024 * 1024,
  maxEntries: 50_000,
  sourceChunk: 100,
};
/** The job is dropped on failure, so the status returns to `none`; the message reaches only the worker log. */
export class UserDataError extends Error {}

const json = (value: unknown) => JSON.stringify(value, null, 4);
const TEMP_FILE_AGE_MS = 86_400_000;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
/** The sweep touches only the names `userDataPath` and `userDataTempPath` produce. */
const ZIP_FILE = new RegExp(`^${UUID}\\.zip$`);
const TEMP_FILE = new RegExp(`^${UUID}\\.zip\\.[^/]+\\.tmp$`);

const submissionInfo = (submissions: UserDataSubmission[]) =>
  Object.fromEntries(
    submissions.map((row) => [
      row.id,
      {
        problem: row.problem,
        date: row.date.toISOString(),
        time: row.time,
        memory: row.memory,
        language: row.language,
        status: row.status,
        result: row.result,
        case_points: row.casePoints,
        case_total: row.caseTotal,
      },
    ]),
  );

const commentInfo = (comments: UserDataComment[]) =>
  Object.fromEntries(
    comments.map((comment) => [
      comment.id,
      {
        date: comment.date.toISOString(),
        page: comment.page,
        score: comment.score,
        hidden: comment.hidden,
      },
    ]),
  );

const postInfo = (posts: UserDataPost[]) =>
  Object.fromEntries(
    posts.map((post) => [
      post.id,
      {
        title: post.title,
        publish_on: post.publishOn.toISOString(),
        visible: post.visible,
        organization: post.organization,
        score: post.score,
      },
    ]),
  );

@Injectable()
export class UserDataService {
  constructor(
    private readonly repository: UserDataRepository,
    private readonly community: UserDataCommunityRepository,
    @Inject(ENV) private readonly env: Env,
    @Inject(USER_DATA_LIMITS) private readonly limits: UserDataLimits,
  ) {}

  /** Legacy `prepare_user_data` plus the profile, own comments (hidden included) and blog posts. The previous zip goes first; the new one is written beside it and renamed into place. Returns the entry count. */
  async prepare(userId: string): Promise<number> {
    const root = this.root();
    const [path, temporary] = [
      userDataPath(root, userId),
      userDataTempPath(root, userId, randomUUID()),
    ];
    await mkdir(root, { recursive: true });
    await rm(path, { force: true });
    const profile = await this.repository.profile(userId);
    if (!profile) return 0;
    const submissions = await this.repository.submissionsOf(
      userId,
      this.limits.maxEntries + 1,
    );
    const [comments, posts] = await Promise.all([
      this.community.commentsOf(userId, this.limits.maxEntries + 1),
      this.community.postsOf(userId, this.limits.maxEntries + 1),
    ]);
    const texts: Array<[name: string, text: string]> = [
      ['profile.json', json(profile)],
    ];
    if (submissions.length)
      texts.push(['submissions/info.json', json(submissionInfo(submissions))]);
    if (comments.length)
      texts.push(['comments/info.json', json(commentInfo(comments))]);
    if (posts.length) texts.push(['posts/info.json', json(postInfo(posts))]);
    /** Bodies, contents and sources are read a chunk at a time, in this order. */
    const streams = [
      {
        names: comments.map((comment) => `comments/${comment.id}.txt`),
        at: this.chunked(comments, (ids) => this.community.commentBodies(ids)),
      },
      {
        names: posts.map((post) => `posts/${post.id}.md`),
        at: this.chunked(posts, (ids) => this.community.postTexts(ids)),
      },
      {
        names: submissions.map(
          (row) =>
            `submissions/${row.id}.${row.extension.replace(/[^A-Za-z0-9]/g, '') || 'txt'}`,
        ),
        at: this.chunked(submissions, (ids) => this.repository.sources(ids)),
      },
    ];
    const names = [
      ...texts.map(([name]) => name),
      ...streams.flatMap((stream) => stream.names),
    ];
    if (names.length > this.limits.maxEntries)
      throw new UserDataError(`More than ${this.limits.maxEntries} entries`);
    await writeZipInPlace(
      names,
      async (index) => {
        if (index < texts.length) return texts[index][1];
        let offset = index - texts.length;
        for (const stream of streams) {
          if (offset < stream.names.length) return stream.at(offset);
          offset -= stream.names.length;
        }
        return '';
      },
      path,
      temporary,
      this.limits.maxBytes,
      () => new UserDataError(`Your data passes ${this.limits.maxBytes} bytes`),
    );
    return names.length;
  }

  private chunked(
    rows: Array<{ id: string }>,
    fetch: (ids: string[]) => Promise<Map<string, string>>,
  ) {
    return chunkedSources(
      rows.map((row) => row.id),
      this.limits.sourceChunk,
      fetch,
    );
  }

  /** Own zips past their seven days and own temp files of crashed runs older than a day; any other file in the root is left alone. Returns the files removed. */
  async sweep(now = new Date()): Promise<number> {
    const root = this.env.userDataRoot;
    if (!root) return 0;
    let removed = 0;
    for (const name of await readdir(root).catch(() => [] as string[])) {
      const path = join(root, name);
      const file = await stat(path).catch(() => null);
      if (!file) continue;
      const expired = TEMP_FILE.test(name)
        ? file.mtime.getTime() + TEMP_FILE_AGE_MS <= now.getTime()
        : ZIP_FILE.test(name) && isUserDataExpired(file.mtime, now);
      if (expired) {
        await rm(path, { force: true });
        removed += 1;
      }
    }
    return removed;
  }

  private root(): string {
    if (!this.env.userDataRoot)
      throw new UserDataError('User data export is not configured');
    return this.env.userDataRoot;
  }
}
