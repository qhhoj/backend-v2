import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { TICKETS_PAGE_SIZE } from '@libs/community';
import { GeneralIssue, isUuid, Ticket } from '@libs/database';
import type { FilterQuery, HydratedDocument, Model } from 'mongoose';

export type TicketDocument = HydratedDocument<Ticket>;

/** Message arrays hold up to 500 rows: only the detail loads them. */
const WITHOUT_MESSAGES = { messages: 0 } as const;
/** List rows carry neither messages nor staff notes. */
const LIST_PROJECTION = { messages: 0, notes: 0 } as const;

@Injectable()
export class TicketsRepository {
  constructor(
    @InjectModel(Ticket.name) private readonly tickets: Model<Ticket>,
    @InjectModel(GeneralIssue.name)
    private readonly issues: Model<GeneralIssue>,
  ) {}

  /** A malformed id is "not found", never a Mongoose CastError. */
  findById(id: string, withMessages = false): Promise<TicketDocument | null> {
    return isUuid(id)
      ? this.tickets
          .findById(id, withMessages ? undefined : WITHOUT_MESSAGES)
          .exec()
      : Promise.resolve(null);
  }

  /** Newest first. */
  async page(
    filter: FilterQuery<Ticket>,
    page: number,
  ): Promise<{ rows: TicketDocument[]; total: number }> {
    const [rows, total] = await Promise.all([
      this.tickets
        .find(filter, LIST_PROJECTION)
        .sort({ _id: -1 })
        .skip((page - 1) * TICKETS_PAGE_SIZE)
        .limit(TICKETS_PAGE_SIZE)
        .exec(),
      this.count(filter),
    ]);
    return { rows, total };
  }

  /** `countDocuments({})` scans the collection; the unfiltered total comes from metadata. */
  private count(filter: FilterQuery<Ticket>): Promise<number> {
    return Object.keys(filter).length
      ? this.tickets.countDocuments(filter).exec()
      : this.tickets.estimatedDocumentCount().exec();
  }

  findIssues(ids: string[]): Promise<GeneralIssue[]> {
    return ids.length
      ? this.issues.find({ _id: { $in: ids } }).exec()
      : Promise.resolve([]);
  }
}
