import type { AssignmentRef } from '@libs/judge-proto';

/** What the bridge sends a judge for one claimed run (`Assign`); built from Mongo by the claim. */
export interface AssignRequest {
  ref: AssignmentRef;
  /** The code judges know the problem by: a mirror's root code. */
  problemCode: string;
  /** `dataVersion` of that problem (the root's for a mirror). */
  dataVersion: number;
  languageKey: string;
  /** Inline source text, or for a file-only language the media URL of the upload (the judge fetches it with FetchSource). */
  source: string;
  fileOnly: boolean;
  /** Bytes of the inline source or of the uploaded file. */
  sourceSize: number;
  /** Seconds; a per-language override wins over the problem's. */
  timeLimit: number;
  /** KiB; a per-language override wins over the problem's. */
  memoryLimit: number;
  shortCircuit: boolean;
  pretestsOnly: boolean;
  /** Participation number (0 live, -1 spectate, n virtual); null outside contests. */
  inContest: number | null;
  attemptNo: number;
  userId: string;
}
