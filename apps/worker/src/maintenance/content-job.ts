/** One document's planned change: the columns as stored (`before`, also the backup) and as they will be (`after`). */
export interface RowChange {
  collection: string;
  id: string;
  /** Column path to stored value. The write lands only while every one still has this value. The first key is the one a dry run shows. */
  before: Record<string, string>;
  after: Record<string, string>;
  /** Files to store before the row is written (re-hosted images). Never stored by a dry run. */
  files?: { path: string; content: Buffer }[];
}

/** Named counters a job fills for things it left alone (a render limit, a failed download); printed at the end. */
export type Tally = (reason: string) => void;

/** One live content fix. `scan` and `write` never touch submissions, judging or scores. */
export interface ContentJob {
  readonly name: string;
  /** Plans changes in chunks of at most `chunkSize` rows, in `_id` order; a row that needs no change is not yielded (this is what makes a second run change nothing). */
  scan(chunkSize: number, tally: Tally): AsyncGenerator<RowChange[]>;
  /** Compare-and-set per row against `before`, keeping `updatedAt`. Returns the rows written. */
  write(changes: readonly RowChange[]): Promise<number>;
}
