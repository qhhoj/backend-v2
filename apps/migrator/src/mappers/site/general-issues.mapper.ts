import { Injectable } from '@nestjs/common';
import { MapCtx, MappedDocument, Mapper } from '../../mapper';

type Row = { id: number; issue_url: string };

@Injectable()
export class GeneralIssuesMapper implements Mapper<Row> {
  name = 'general-issues';
  collection = 'generalIssues';
  refTables = ['judge_generalissue'];
  sql = 'SELECT id, issue_url FROM judge_generalissue ORDER BY id';

  map(row: Row, ctx: MapCtx): MappedDocument {
    return {
      _id: ctx.ref('judge_generalissue', row.id)!,
      issueUrl: row.issue_url,
      createdAt: null,
      updatedAt: null,
    };
  }
}
