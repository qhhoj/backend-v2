import { mkdir, open } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { RowChange } from './content-job';

/** Append-only JSON-lines file of the rows a job is about to change: `{collection, id, before, after}` per line (`after` lets a restore check that the row was not edited since: restore only a row that still holds `after`). Never overwrites a file (`wx`), is readable by its owner only (it can hold unpublished statements and private posts), and each chunk is on disk before its rows are written. */
export class BackupFile {
  private constructor(private readonly handle: FileHandle) {}

  static async create(path: string): Promise<BackupFile> {
    await mkdir(dirname(path), { recursive: true });
    return new BackupFile(await open(path, 'wx', 0o600));
  }

  async append(changes: readonly RowChange[]): Promise<void> {
    if (!changes.length) return;
    const lines = changes.map(({ collection, id, before, after }) =>
      JSON.stringify({ collection, id, before, after }),
    );
    await this.handle.appendFile(`${lines.join('\n')}\n`);
    await this.handle.sync();
  }

  close(): Promise<void> {
    return this.handle.close();
  }
}
