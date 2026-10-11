import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { ContestParticipation, ContestSubmission } from '@libs/database';
import type { ParticipationDocument } from '../core/participations.repository';

/** Editor writes to participations that no contestant flow makes. */
@Injectable()
export class ParticipationAdminRepository {
  constructor(
    @InjectModel(ContestParticipation.name)
    private readonly participations: Model<ContestParticipation>,
    @InjectModel(ContestSubmission.name)
    private readonly contestSubmissions: Model<ContestSubmission>,
  ) {}

  /** A set start also ends a pending registration. */
  setRealStart(
    id: string,
    realStart: Date,
  ): Promise<ParticipationDocument | null> {
    return this.participations
      .findByIdAndUpdate(
        id,
        { $set: { realStart, isRegistered: false } },
        { new: true },
      )
      .exec();
  }

  /** Through the `{participation, problem}` index. */
  async hasSubmissions(participationId: string): Promise<boolean> {
    return (
      (await this.contestSubmissions
        .exists({ participation: participationId })
        .exec()) !== null
    );
  }

  async delete(id: string): Promise<boolean> {
    const { deletedCount } = await this.participations
      .deleteOne({ _id: id })
      .exec();
    return deletedCount === 1;
  }
}
