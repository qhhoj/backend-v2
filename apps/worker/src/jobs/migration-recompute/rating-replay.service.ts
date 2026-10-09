import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { FREEZE_FORMATS } from '@libs/contests';
import { uuidStr } from '@libs/database';
import type { RatingReplayResult } from '@libs/judging';
import { ContestRatingService } from '../contest-rating/contest-rating.service';

/** User ruling: legacy ratings are not kept; every rated contest is re-rated with the v2 code, in end-time order, from an empty history. */
@Injectable()
export class RatingReplayService {
  constructor(
    @InjectConnection() private readonly conn: Connection,
    private readonly ratings: ContestRatingService,
  ) {}

  /** Idempotent: starts from no rating at all, so a re-run with the same data rebuilds the same rows. */
  async replay(now: Date): Promise<RatingReplayResult> {
    await this.conn.collection('ratings').deleteMany({});
    await this.conn
      .collection('users')
      .updateMany({ rating: { $ne: null } }, { $set: { rating: null } });
    const ended = { isRated: true, endTime: { $lte: now } };
    const frozen = {
      formatName: { $in: [...FREEZE_FORMATS] },
      frozenLastMinutes: { $gt: 0 },
    };
    const contests = this.conn.collection('contests');
    const frozenRatedContests = await contests.countDocuments({
      ...ended,
      ...frozen,
    });
    const first = await contests
      .find({ ...ended, $nor: [frozen] }, { projection: { _id: 1 } })
      .sort({ endTime: 1, _id: 1 })
      .limit(1)
      .next();
    if (!first) return { ratedContests: 0, ratings: 0, frozenRatedContests };
    const { contests: ratedContests, ratings } = await this.ratings.rateFrom(
      uuidStr(first._id),
      now,
    );
    return { ratedContests, ratings, frozenRatedContests };
  }
}
