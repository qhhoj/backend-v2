/** The imported problem, once the job completed. */
export class ImportResultResponse {
  /** Id of the created or updated problem. */
  problemId!: string;
  /** Its code. */
  code!: string;
}

export class ImportJobResponse {
  /** Job id. */
  id!: string;
  /** BullMQ state: waiting | active | completed | failed | delayed | prioritized. */
  state!: string;
  /** The imported problem; null until the job completes. */
  result!: ImportResultResponse | null;
  /** Only an import error written for the requester; any other failure is "Import failed". */
  error!: string | null;
}
