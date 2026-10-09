import { Injectable } from '@nestjs/common';
import { LegacySourceService } from '../../legacy-source.service';
import { MapCtx, MappedDocument, Mapper } from '../../mapper';
import { TicketSources } from './ticket-sources';

type Row = {
  id: number;
  title: string;
  time: Date;
  notes: string;
  object_id: number;
  is_open: number;
  content_type_id: number;
  user_id: number;
  is_contributive: number;
};

@Injectable()
export class TicketsMapper implements Mapper<Row> {
  name = 'tickets';
  collection = 'tickets';
  refTables = [
    'judge_ticket',
    'judge_ticketmessage',
    'judge_profile',
    'judge_problem',
    'judge_generalissue',
  ];
  sql = `SELECT id, title, time, notes, object_id, is_open, content_type_id, user_id, is_contributive
    FROM judge_ticket ORDER BY id`;
  private readonly sources = new TicketSources();

  async prepare(source: LegacySourceService) {
    await this.sources.load(source);
  }

  map(row: Row, ctx: MapCtx): MappedDocument | null {
    const linkedItem = this.sources.linkOf(
      row.content_type_id,
      row.object_id,
      ctx,
    );
    const user = ctx.refOrNull('judge_profile', row.user_id);
    if (typeof linkedItem === 'string' || !user) {
      const reason =
        typeof linkedItem === 'string'
          ? `${linkedItem} not linkable`
          : 'author missing';
      ctx.report(`skipped judge_ticket:${row.id} (${reason})`);
      return null;
    }
    const messages = this.sources.messagesOf(row.id, ctx);
    const lastMessageAt = messages.at(-1)?.createdAt ?? ctx.date(row.time);
    return {
      _id: ctx.ref('judge_ticket', row.id)!,
      title: row.title,
      user,
      assignees: this.sources.assigneesOf(row.id, ctx),
      notes: row.notes ?? '',
      linkedItem,
      isContributive: ctx.bool(row.is_contributive),
      isOpen: ctx.bool(row.is_open),
      messages,
      messageCount: messages.length,
      lastMessageAt,
      createdAt: ctx.date(row.time),
      updatedAt: lastMessageAt,
    };
  }
}
