import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { realpath, stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { Connection } from 'mongoose';
import { escapeRegExp } from '@libs/common';
import { DATA_FILE_KINDS, uuidStr } from '@libs/database';
import { mediaUrl, requiredEnv } from './legacy-env';

type Report = { checked: number; missing: string[]; unchecked: string[] };
/** `path` null: the reference escapes `root`, so it counts as missing. */
type Wanted = { label: string; path: string | null; root: string };
type Roots = { problemData: string; media: string };
const MEDIA_FIELDS = ['materialUrl', 'pdfStatementUrl'] as const;

/** `relative` resolved under `root`; null when it escapes it (a `..` in a code or a file name). */
const inside = (root: string | null, relative: string): string | null => {
  if (root === null) return null;
  const path = resolve(root, relative);
  return path.startsWith(resolve(root) + sep) ? path : null;
};

/** A regular file whose real path (symlinks followed) is still inside `root`. */
const present = async ({ path, root }: Wanted): Promise<boolean> => {
  if (path === null) return false;
  try {
    return (
      inside(await realpath(root), await realpath(path)) !== null &&
      (await stat(path)).isFile()
    );
  } catch {
    return false;
  }
};

/** D5: every file a migrated document names must be on the copied volumes. */
@Injectable()
export class FileCheckService {
  constructor(@InjectConnection() private readonly conn: Connection) {}

  async run(
    roots: Roots = {
      problemData: requiredEnv('PROBLEM_DATA_ROOT'),
      media: requiredEnv('MEDIA_ROOT'),
    },
  ): Promise<Report> {
    const unchecked: string[] = [];
    const wanted = [
      ...(await this.problemFiles(roots, unchecked)),
      ...(await this.sourceFiles(roots.media)),
    ];
    const missing: string[] = [];
    for (const file of wanted)
      if (!(await present(file))) missing.push(file.label);
    return { checked: wanted.length, missing, unchecked };
  }

  private async problemFiles(
    roots: Roots,
    unchecked: string[],
  ): Promise<Wanted[]> {
    const wanted: Wanted[] = [];
    const cursor = this.conn.collection('problems').find(
      {},
      {
        projection: { code: 1, data: 1, materialUrl: 1, pdfStatementUrl: 1 },
      },
    );
    for await (const problem of cursor) {
      const folder = inside(roots.problemData, String(problem.code));
      for (const kind of DATA_FILE_KINDS) {
        const name: unknown = (
          problem.data as Record<string, unknown> | undefined
        )?.[kind];
        if (typeof name === 'string' && name)
          wanted.push({
            label: `${problem.code} data.${kind}`,
            path: inside(folder, name),
            root: roots.problemData,
          });
      }
      for (const field of MEDIA_FIELDS) {
        const url: unknown = problem[field];
        if (typeof url !== 'string' || !url) continue;
        if (url.startsWith('/') && !url.startsWith(`${mediaUrl()}/`)) {
          unchecked.push(`${problem.code} ${field}`);
          continue;
        }
        const path = this.mediaPath(url, roots);
        if (path !== '')
          wanted.push({
            label: `${problem.code} ${field}`,
            path,
            root: roots.media,
          });
      }
    }
    return wanted;
  }

  /** The file under MEDIA_ROOT for a MEDIA_URL link; '' for an http(s) link (nothing to check). */
  private mediaPath(url: string, roots: Roots): string | null {
    const prefix = `${mediaUrl()}/`;
    return url.startsWith(prefix)
      ? inside(roots.media, url.slice(prefix.length))
      : '';
  }

  private async sourceFiles(media: string): Promise<Wanted[]> {
    const prefix = `${mediaUrl()}/`;
    const cursor = this.conn
      .collection('submissionSources')
      .find(
        { source: { $regex: `^${escapeRegExp(prefix)}submission_file/` } },
        { projection: { source: 1 } },
      );
    const wanted: Wanted[] = [];
    for await (const row of cursor)
      wanted.push({
        label: `submission source ${uuidStr(row._id)}`,
        path: inside(media, (row.source as string).slice(prefix.length)),
        root: media,
      });
    return wanted;
  }
}
