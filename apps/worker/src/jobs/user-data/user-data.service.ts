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
import { UserDataRepository } from './user-data.repository';
import type {
  UserDataComment,
  UserDataPost,
  UserDataSubmission,
} from './user-data.repository';

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
      this.repository.commentsOf(userId, this.limits.maxEntries + 1),
      this.repository.postsOf(userId, this.limits.maxEntries + 1),
    ]);
    const texts: Array<[name: string, text: string]> = [
      ['profile.json', json(profile)],
    ];
    if (submissions.length)
      texts.push(['submissions/info.json', json(submissionInfo(submissions))]);
    if (comments.length)
      texts.push(
        ['comments/info.json', json(commentInfo(comments))],
        ...comments.map((comment): [string, string] => [
          `comments/${comment.id}.txt`,
          comment.body,
        ]),
      );
    if (posts.length)
      texts.push(
        ['posts/info.json', json(postInfo(posts))],
        ...posts.map((post): [string, string] => [
          `posts/${post.id}.md`,
          post.summary
            ? `${post.content}\n\n---\n\n${post.summary}`
            : post.content,
        ]),
      );
    const sourceNames = submissions.map(
      (row) =>
        `submissions/${row.id}.${row.extension.replace(/[^A-Za-z0-9]/g, '') || 'txt'}`,
    );
    const names = [...texts.map(([name]) => name), ...sourceNames];
    if (names.length > this.limits.maxEntries)
      throw new UserDataError(`More than ${this.limits.maxEntries} entries`);
    const sourceAt = chunkedSources(
      submissions.map((row) => row.id),
      this.limits.sourceChunk,
      (ids) => this.repository.sources(ids),
    );
    await writeZipInPlace(
      names,
      async (index) =>
        index < texts.length ? texts[index][1] : sourceAt(index - texts.length),
      path,
      temporary,
      this.limits.maxBytes,
      () => new UserDataError(`Your data passes ${this.limits.maxBytes} bytes`),
    );
    return names.length;
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
