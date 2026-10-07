import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { isDuplicateKey } from '@libs/common';
import { ContestPublicRankingLink } from '@libs/database';
import { generateRankingToken, linkExpiry } from './ranking-link';

const TOKEN_ATTEMPTS = 10;

@Injectable()
export class RankingLinksRepository {
  constructor(
    @InjectModel(ContestPublicRankingLink.name)
    private readonly links: Model<ContestPublicRankingLink>,
  ) {}

  findByContest(contestId: string) {
    return this.links.findOne({ contest: contestId }).exec();
  }

  findByToken(token: string) {
    return this.links
      .findOne({ token })
      .lean<ContestPublicRankingLink>()
      .exec();
  }

  /** Legacy `get_or_create_for`: a concurrent create of the same contest returns the winner; a token collision retries. */
  async getOrCreate(contestId: string, now: Date) {
    for (let attempt = 0; attempt < TOKEN_ATTEMPTS; attempt += 1) {
      const existing = await this.findByContest(contestId);
      if (existing) return existing;
      try {
        return await this.links.create({
          contest: contestId,
          token: generateRankingToken(),
          regeneratedAt: now,
        });
      } catch (error) {
        if (!isDuplicateKey(error)) throw error;
      }
    }
    throw new Error('No unique public ranking token');
  }

  update(id: string, changes: Partial<ContestPublicRankingLink>) {
    return this.links
      .findByIdAndUpdate(
        id,
        { $set: changes },
        { new: true, runValidators: true },
      )
      .exec();
  }

  /** A new token restarts minute and day expiries (legacy `regenerate`). */
  async regenerate(link: ContestPublicRankingLink, now: Date) {
    for (let attempt = 0; attempt < TOKEN_ATTEMPTS; attempt += 1) {
      try {
        return await this.update(link._id, {
          token: generateRankingToken(),
          regeneratedAt: now,
          expiresAt: linkExpiry(link, now),
        });
      } catch (error) {
        if (!isDuplicateKey(error, 'token')) throw error;
      }
    }
    throw new Error('No unique public ranking token');
  }
}
