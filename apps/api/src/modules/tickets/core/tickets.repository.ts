import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import {
  TICKET_MESSAGE_CAP,
  TICKET_TIMELINE_CAP,
  TICKETS_PAGE_SIZE,
} from '@libs/community';
import type { TicketStateSnapshot, TicketTimelineDraft } from '@libs/community';
import { GeneralIssue, isUuid, newId, Ticket, uuidStr } from '@libs/database';
import type { TicketMessage } from '@libs/database';
import type {
  Connection,
  FilterQuery,
  HydratedDocument,
  Model,
  UpdateQuery,
} from 'mongoose';

export type TicketDocument = HydratedDocument<Ticket>;

/** Message and timeline arrays hold up to 500 and 200 rows: only the detail loads them. */
const WITHOUT_MESSAGES = { messages: 0, events: 0 } as const;
/** List rows carry neither messages, timeline nor staff notes. */
const LIST_PROJECTION = { messages: 0, events: 0, notes: 0 } as const;

export type TicketChanges = Partial<
  Pick<
    Ticket,
    'isOpen' | 'isContributive' | 'notes' | 'assignees' | 'title' | 'linkedItem'
  >
>;

/** What an update read before writing: the state fields, and the title and link a retitle or relink compares against. */
export type TicketReadState = TicketStateSnapshot &
  Partial<Pick<Ticket, 'title' | 'linkedItem'>>;

/** The guard of a compare-and-set: each field the update changes must still hold the value that was read. */
function unchangedSince(
  changes: TicketChanges,
  read: TicketReadState,
): FilterQuery<Ticket> {
  const guard: FilterQuery<Ticket> = {};
  if (changes.title !== undefined) guard.title = read.title;
  if (changes.linkedItem !== undefined && read.linkedItem) {
    guard['linkedItem.type'] = read.linkedItem.type;
    guard['linkedItem.id'] = read.linkedItem.id;
  }
  if (changes.isOpen !== undefined) guard.isOpen = read.isOpen;
  if (changes.isContributive !== undefined)
    guard.isContributive = read.isContributive;
  if (changes.assignees !== undefined)
    guard.assignees = read.assignees.length
      ? { $all: [...read.assignees], $size: read.assignees.length }
      : { $size: 0 };
  return guard;
}

@Injectable()
export class TicketsRepository {
  /** Open tickets whose newest message was not written by staff. `null` matches a document without the field (tickets from the migrator's raw bulkWrite, and tickets that predate the flag), so they count as waiting. Through `{isOpen, lastMessageByStaff}`. */
  static readonly AWAITING_STAFF: FilterQuery<Ticket> = {
    isOpen: true,
    lastMessageByStaff: { $in: [false, null] },
  };

  constructor(
    @InjectModel(Ticket.name) private readonly tickets: Model<Ticket>,
    @InjectModel(GeneralIssue.name)
    private readonly issues: Model<GeneralIssue>,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  /** A malformed id is "not found", never a Mongoose CastError. */
  findById(
    id: string,
    { withMessages = false }: { withMessages?: boolean } = {},
  ): Promise<TicketDocument | null> {
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

  /** One `updateOne`, a compare-and-set on the changed fields: the changes and their timeline entries commit together, or nothing does. `$slice` keeps the newest `TICKET_TIMELINE_CAP` entries, so a full timeline never refuses the state change. False = the ticket is gone or changed since `read`. */
  async update(
    ticketId: string,
    changes: TicketChanges,
    read: TicketReadState,
    events: readonly TicketTimelineDraft[] = [],
  ): Promise<boolean> {
    if (!Object.keys(changes).length) return true;
    const update: UpdateQuery<Ticket> = { $set: changes };
    if (events.length)
      update.$push = {
        events: {
          $each: events.map((event) => ({ _id: newId(), ...event })),
          $slice: -TICKET_TIMELINE_CAP,
        },
      };
    const { matchedCount } = await this.tickets
      .updateOne({ _id: ticketId, ...unchangedSince(changes, read) }, update)
      .exec();
    return matchedCount === 1;
  }

  /** The cap is part of the filter, so parallel posts can never pass it; false = the ticket is full (or gone). `byStaff` is stored: staff status changes over time. */
  async pushMessage(
    ticketId: string,
    message: TicketMessage,
    byStaff: boolean,
  ): Promise<boolean> {
    const { modifiedCount } = await this.tickets
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
          $set: {
            lastMessageAt: message.createdAt,
            lastMessageByStaff: byStaff,
          },
          $inc: { messageCount: 1 },
        },
      )
      .exec();
    return modifiedCount === 1;
  }

  /** Open tickets assigned to the user. Through `{assignees, _id}`. */
  countAssignedOpen(userId: string): Promise<number> {
    return this.tickets
      .countDocuments({ assignees: userId, isOpen: true })
      .exec();
  }

  /** Open tickets among `filter`. */
  countOpen(filter: FilterQuery<Ticket>): Promise<number> {
    return this.tickets.countDocuments({ ...filter, isOpen: true }).exec();
  }

  /** See `AWAITING_STAFF`. */
  countAwaitingStaff(): Promise<number> {
    return this.tickets.countDocuments(TicketsRepository.AWAITING_STAFF).exec();
  }
}
