import { UserSummaryResponse } from '../../../problems/core/dto/user-summary.response';

export class ActivityLogResponse {
  id!: string;
  at!: Date;
  /** Null for anonymous visitors. */
  username!: string | null;
  ip!: string;
  path!: string;
  method!: string;
  statusCode!: number;
  userAgent!: string;
  referer!: string;
}

export class ActivitySessionResponse {
  id!: string;
  ip!: string;
  userAgent!: string;
  deviceType!: string;
  browser!: string;
  os!: string;
  createdAt!: Date;
  lastActivityAt!: Date;
}

export class ActivityCountResponse {
  value!: string;
  count!: number;
}

export class ActivityDayResponse {
  /** UTC day, `YYYY-MM-DD`. */
  day!: string;
  count!: number;
}

export class ActivitySummaryResponse {
  username!: string;
  total!: number;
  daily!: ActivityDayResponse[];
  topIps!: ActivityCountResponse[];
  topPaths!: ActivityCountResponse[];
  /** The 50 most recent. */
  sessions!: ActivitySessionResponse[];
}

export class LiveUserResponse {
  user!: UserSummaryResponse;
  lastSeenAt!: Date;
}

export class LiveActivityResponse {
  windowMinutes!: number;
  authenticatedUsers!: number;
  anonymousVisitors!: number;
  bots!: number;
  /** Signed-in users, most recently seen first. */
  users!: LiveUserResponse[];
}
