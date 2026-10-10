import { UserSummaryResponse } from '../../../problems/core/dto/user-summary.response';

export class ActivityLogResponse {
  /** Log row id. */
  id!: string;
  /** When the request was made. */
  at!: Date;
  /** Null for anonymous visitors. */
  username!: string | null;
  /** Client IP address. */
  ip!: string;
  /** Request path. */
  path!: string;
  /** HTTP method. */
  method!: string;
  /** HTTP status code of the response. */
  statusCode!: number;
  /** User-Agent header. */
  userAgent!: string;
  /** Referer header. */
  referer!: string;
}

export class ActivitySessionResponse {
  /** Session id. */
  id!: string;
  /** IP address the session started from. */
  ip!: string;
  /** User-Agent header. */
  userAgent!: string;
  /** Device class parsed from the user agent. */
  deviceType!: string;
  /** Browser parsed from the user agent. */
  browser!: string;
  /** Operating system parsed from the user agent. */
  os!: string;
  /** When the session started. */
  createdAt!: Date;
  /** When the session was last used. */
  lastActivityAt!: Date;
}

export class ActivityCountResponse {
  /** The IP address or path counted. */
  value!: string;
  /** Number of requests. */
  count!: number;
}

export class ActivityDayResponse {
  /** UTC day, `YYYY-MM-DD`. */
  day!: string;
  /** Number of requests that day. */
  count!: number;
}

export class ActivitySummaryResponse {
  /** Username the summary is for. */
  username!: string;
  /** Total requests in the period. */
  total!: number;
  /** Requests per UTC day. */
  daily!: ActivityDayResponse[];
  /** The 20 most used IP addresses. */
  topIps!: ActivityCountResponse[];
  /** The 30 most requested paths. */
  topPaths!: ActivityCountResponse[];
  /** The 50 most recent. */
  sessions!: ActivitySessionResponse[];
}

export class LiveUserResponse {
  /** The signed-in user. */
  user!: UserSummaryResponse;
  /** When the user was last seen. */
  lastSeenAt!: Date;
}

export class LiveActivityResponse {
  /** Length of the "now" window in minutes. */
  windowMinutes!: number;
  /** Signed-in users seen in the window. */
  authenticatedUsers!: number;
  /** Signed-out visitors seen in the window. */
  anonymousVisitors!: number;
  /** Bot requests seen in the window. */
  bots!: number;
  /** Signed-in users, most recently seen first. */
  users!: LiveUserResponse[];
  /** True when a later `page` has more signed-in users (measured on the live set, so a user without an account still counts). */
  hasMore!: boolean;
}
