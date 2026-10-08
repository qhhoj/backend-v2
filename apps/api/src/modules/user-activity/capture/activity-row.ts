/** One response, as the hook saw it. */
export interface ActivityRow {
  userId: string | null;
  sessionKey: string;
  ip: string;
  userAgent: string;
  referer: string;
  /** Without the query string, link credentials redacted. */
  path: string;
  method: string;
  statusCode: number;
  at: Date;
}
