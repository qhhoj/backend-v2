import { Injectable } from '@nestjs/common';
import { MapCtx, MappedDocument, Mapper } from '../../mapper';

interface Row {
  id: number;
  title: string;
  description: string;
  date: Date;
  contest_id: number;
}

@Injectable()
export class ContestAnnouncementsMapper implements Mapper<Row> {
  name = 'contest-announcements';
  collection = 'contestAnnouncements';
  refTables = ['judge_contestannouncement', 'judge_contest'];
  sql =
    'SELECT id, title, description, date, contest_id FROM judge_contestannouncement ORDER BY id';

  map(row: Row, ctx: MapCtx): MappedDocument | null {
    const contest = ctx.refOrNull('judge_contest', row.contest_id);
    if (!contest) return null;
    return {
      _id: ctx.ref('judge_contestannouncement', row.id)!,
      contest,
      title: row.title,
      description: row.description ?? '',
      descriptionHtml: ctx.render(
        row.description,
        'problem',
        `judge_contestannouncement:${row.id}`,
      ),
      createdAt: ctx.date(row.date),
      updatedAt: ctx.date(row.date),
    };
  }
}
