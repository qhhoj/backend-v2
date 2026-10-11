export class QueuePriorityResponse {
  /** 0 contest, 1 normal, 2 rejudge, 3 batch rejudge. */
  priority!: number;
  /** Queued submissions at this priority. */
  count!: number;
  /** When the longest-waiting one was submitted or rejudged. */
  oldestSince!: Date;
}

export class QueueLanguageResponse {
  /** Language id. */
  id!: string;
  /** Language key; null when the language is gone. */
  key!: string | null;
  /** Display name; null when the language is gone. */
  name!: string | null;
  /** Queued submissions in this language. */
  count!: number;
  /** Connected, usable judges that run it; 0 means the queue cannot drain. */
  onlineJudges!: number;
}

export class QueuePinnedResponse {
  /** Judge name the submissions wait for. */
  judge!: string;
  /** Queued submissions pinned to it. */
  count!: number;
  /** Whether that judge is connected and takes work. */
  online!: boolean;
}

export class JudgeQueueResponse {
  /** Waiting for a judge (QU). */
  queued!: number;
  /** Handed to a judge, not started (P). */
  processing!: number;
  /** Being graded (G). */
  grading!: number;
  /** When the longest-waiting queued submission was submitted or rejudged; null when none waits. */
  oldestQueuedSince!: Date | null;
  /** Queued submissions per priority, most urgent first. */
  byPriority!: QueuePriorityResponse[];
  /** Queued submissions per language, largest first. */
  byLanguage!: QueueLanguageResponse[];
  /** Queued submissions pinned to one judge, largest first. */
  pinned!: QueuePinnedResponse[];
}
