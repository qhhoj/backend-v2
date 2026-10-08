/** The imported problem, once the job completed. */
export class ImportResultResponse {
  problemId!: string;
  code!: string;
}

export class ImportJobResponse {
  id!: string;
  /** BullMQ state: waiting | active | completed | failed | delayed | prioritized. */
  state!: string;
  result!: ImportResultResponse | null;
  /** Only an import error written for the requester; any other failure is "Import failed". */
  error!: string | null;
}
