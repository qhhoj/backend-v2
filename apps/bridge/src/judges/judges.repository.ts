import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { constantTimeEqual, sha256 } from '@libs/auth';
import { Judge, JUDGE_NAME_PATTERN } from '@libs/database';
import type { Runtime } from '../protocol/judge-packets';

/** What a judge row holds while no connection serves it; written by `markOffline` and by the bridge's start-up sweep. */
export const OFFLINE_FIELDS = {
  online: false,
  ping: null,
  load: null,
  runtimes: [],
} as const;

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
  ): Promise<{ isDisabled: boolean } | null> {
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
      ? { isDisabled: judge.isDisabled }
      : null;
  }

  async markOnline(
    name: string,
    startTime: Date,
    details: { problems: string[]; runtimes: Runtime[]; lastIp: string | null },
  ): Promise<void> {
    await this.judges.updateOne(
      { name },
      { $set: { online: true, startTime, ping: null, load: null, ...details } },
    );
  }

  async markOffline(name: string, startTime: Date): Promise<void> {
    await this.judges.updateOne({ name, startTime }, { $set: OFFLINE_FIELDS });
  }

  async updatePing(
    name: string,
    startTime: Date,
    ping: number,
    load: number | null,
  ): Promise<void> {
    await this.judges.updateOne({ name, startTime }, { $set: { ping, load } });
  }

  async updateProblems(
    name: string,
    startTime: Date,
    problems: string[],
  ): Promise<void> {
    await this.judges.updateOne({ name, startTime }, { $set: { problems } });
  }

  /** Bridge start: no judge is connected yet, whatever the last run left behind. */
  async setAllOffline(): Promise<void> {
    await this.judges.updateMany({}, { $set: OFFLINE_FIELDS });
  }
}
