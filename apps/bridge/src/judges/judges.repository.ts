import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { constantTimeEqual, sha256 } from '@libs/auth';
import { Judge, JUDGE_NAME_PATTERN } from '@libs/database';
import type { HelloRuntime } from '../link/messages';

/** What a judge row holds while no connection serves it; written by `markOffline` and by the bridge's start-up sweep. */
export const OFFLINE_FIELDS = {
  online: false,
  ping: null,
  load: null,
  runtimes: [],
  busy: 0,
} as const;

/** What a judge's Hello and connection tell the admin page. */
export interface SessionDetails {
  slots: number;
  build: string;
  protocolMinor: number;
  features: string[];
  runtimes: HelloRuntime[];
  lastIp: string | null;
}

export interface JudgeAccess {
  name: string;
  isBlocked: boolean;
  isDisabled: boolean;
  authKeyHash: string;
}

/** Compared when the name is unknown, so the timing does not reveal which names exist. */
const UNKNOWN_JUDGE_HASH = sha256('no such judge');

/** The bridge's writes to `judges`. `startTime` identifies a connection: a replaced connection's late writes filter on its own `startTime` and change nothing. */
@Injectable()
export class JudgesRepository {
  constructor(@InjectModel(Judge.name) private readonly judges: Model<Judge>) {}

  /** Legacy `_authenticate`: the key's hash is compared in constant time; a blocked judge is refused even with the right key. */
  async authenticate(
    name: string,
    key: string,
  ): Promise<{ isDisabled: boolean; authKeyHash: string } | null> {
    const judge = JUDGE_NAME_PATTERN.test(name)
      ? await this.judges
          .findOne({ name }, { authKeyHash: 1, isBlocked: 1, isDisabled: 1 })
          .lean()
      : null;
    const keyMatches = constantTimeEqual(
      sha256(key),
      judge?.authKeyHash ?? UNKNOWN_JUDGE_HASH,
    );
    return judge && keyMatches && !judge.isBlocked
      ? { isDisabled: judge.isDisabled, authKeyHash: judge.authKeyHash }
      : null;
  }

  /** What the resync compares connected judges against: Mongo is the truth when a block, disable or key rotation command was lost. */
  async accessOf(names: string[]): Promise<JudgeAccess[]> {
    return this.judges
      .find(
        { name: { $in: names } },
        { name: 1, isBlocked: 1, isDisabled: 1, authKeyHash: 1 },
      )
      .lean();
  }

  async markOffline(name: string, startTime: Date): Promise<void> {
    await this.judges.updateOne({ name, startTime }, { $set: OFFLINE_FIELDS });
  }

  /** A session said Hello: the row shows it online with what it reported; `startTime` names the session. An older session's late write never displaces a newer one. */
  async markSessionOnline(
    name: string,
    startTime: Date,
    details: SessionDetails,
  ): Promise<void> {
    await this.judges.updateOne(
      { name, startTime: { $not: { $gt: startTime } } },
      {
        $set: {
          online: true,
          startTime,
          ping: null,
          load: null,
          busy: 0,
          ...details,
        },
      },
    );
  }

  /** A pong: the mean round trip, the judge's load and its busy slots. */
  async recordPong(
    name: string,
    startTime: Date,
    pong: { ping: number; load: number | null; busy: number },
  ): Promise<void> {
    await this.judges.updateOne({ name, startTime }, { $set: pong });
  }

  /** Bridge start and stop: no judge is connected, whatever the last run left behind. */
  async setAllOffline(): Promise<void> {
    await this.judges.updateMany({}, { $set: OFFLINE_FIELDS });
  }
}
