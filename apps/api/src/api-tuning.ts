import { PASSWORD_TUNING } from '@libs/auth';
import { STREAM_TUNING } from '@libs/common';
import { POLYGON_TUNING } from '@libs/problems';
import { DEFAULT_FEED_STREAM_OPTIONS } from './modules/contests/feed/feed-stream.service';
import { DEFAULT_FEED_LIMITS } from './modules/contests/feed/feed.service';
import { SHARE_CODE_TUNING } from './modules/shares/core/share-code';
import { SHORT_CODE_TUNING } from './modules/short-links/short-code';

/** The api's tuning (`TUNING`); specs replace parts of it through `setupApiTest({ tuning })`. */
export const apiTuning = {
  ...STREAM_TUNING,
  ...PASSWORD_TUNING,
  ...POLYGON_TUNING,
  ...SHORT_CODE_TUNING,
  ...SHARE_CODE_TUNING,
  feedLimits: DEFAULT_FEED_LIMITS,
  feedStream: DEFAULT_FEED_STREAM_OPTIONS,
};
export type ApiTuning = typeof apiTuning;
