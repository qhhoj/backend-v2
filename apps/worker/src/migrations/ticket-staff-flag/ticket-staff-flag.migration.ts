import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Ticket } from '@libs/database';
import type { Model } from 'mongoose';
import type { Migration } from '../migration';

/** Tickets without `lastMessageByStaff` (the migrator's, and those from before the flag) count as waiting for staff, as `AWAITING_STAFF`'s `$in: [false, null]` reads them (L24 drops the null). */
@Injectable()
export class TicketStaffFlagMigration implements Migration {
  readonly id = '2026-11-06-ticket-staff-flag';

  constructor(
    @InjectModel(Ticket.name) private readonly tickets: Model<Ticket>,
  ) {}

  async run(): Promise<number> {
    const { modifiedCount } = await this.tickets.collection.updateMany(
      { lastMessageByStaff: null },
      { $set: { lastMessageByStaff: false } },
    );
    return modifiedCount;
  }
}
