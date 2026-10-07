import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { HydratedDocument, Model } from 'mongoose';
import { ContestParticipation, isUuid, User } from '@libs/database';

export type ParticipationDocument = HydratedDocument<ContestParticipation>;

@Injectable()
export class ParticipationsRepository {
  constructor(
    @InjectModel(ContestParticipation.name)
    private readonly participations: Model<ContestParticipation>,
    @InjectModel(User.name) private readonly users: Model<User>,
  ) {}

  findById(id: string): Promise<ParticipationDocument | null> {
    return isUuid(id)
      ? this.participations.findById(id).exec()
      : Promise.resolve(null);
  }

  findOne(
    contestId: string,
    userId: string,
    virtual: number,
  ): Promise<ParticipationDocument | null> {
    return this.participations
      .findOne({ contest: contestId, user: userId, virtual })
      .exec();
  }

  /** The participation `users.currentParticipation` points at, null when none (or gone). */
  async findCurrentOf(userId: string): Promise<ParticipationDocument | null> {
    const user = await this.users
      .findById(userId, { currentParticipation: 1 })
      .lean();
    return user?.currentParticipation
      ? this.participations.findById(user.currentParticipation).exec()
      : null;
  }
}
