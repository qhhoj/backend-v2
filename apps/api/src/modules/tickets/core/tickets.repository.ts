import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { TICKET_MESSAGE_CAP, TICKETS_PAGE_SIZE } from '@libs/community';
import { GeneralIssue, isUuid, Ticket, uuidStr } from '@libs/database';
import type { TicketMessage } from '@libs/database';
import type {
  Connection,
  FilterQuery,
  HydratedDocument,
  Model,
} from 'mongoose';

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
    @InjectConnection() private readonly connection: Connection,
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

  /** A general ticket's issue row and the ticket commit together. */
  async create(
    fields: Omit<Partial<Ticket>, 'linkedItem'>,
    link:
      { type: 'problem'; id: string } | { type: 'general'; issueUrl: string },
  ): Promise<TicketDocument> {
    let created!: TicketDocument;
    await this.connection.transaction(async (session) => {
      const linkedItem =
        link.type === 'problem'
          ? { type: link.type, id: link.id }
          : {
              type: link.type,
              id: uuidStr(
                (
                  await this.issues.create([{ issueUrl: link.issueUrl }], {
                    session,
                  })
                )[0]._id,
              ),
            };
      [created] = await this.tickets.create([{ ...fields, linkedItem }], {
        session,
      });
    });
    return created;
  }

  /** The cap is part of the filter, so parallel posts can never pass it; false = the ticket is full (or gone). */
  async pushMessage(
    ticketId: string,
    message: TicketMessage,
  ): Promise<boolean> {
    const result = await this.tickets
      .updateOne(
        {
          _id: ticketId,
          $expr: {
            $lt: [
              { $size: { $ifNull: ['$messages', []] } },
              TICKET_MESSAGE_CAP,
            ],
          },
        },
        {
          $push: { messages: message },
          $set: { lastMessageAt: message.createdAt },
          $inc: { messageCount: 1 },
        },
      )
      .exec();
    return result.modifiedCount === 1;
  }
}
