import { Injectable } from '@nestjs/common';
import { MapCtx, MappedDocument, Mapper } from '../../mapper';

type Row = { id: number; name: string; full_name: string };

@Injectable()
export class ProblemGroupsMapper implements Mapper<Row> {
  name = 'problem-groups';
  collection = 'problemGroups';
  refTables = ['judge_problemgroup'];
  sql = 'SELECT id, name, full_name FROM judge_problemgroup ORDER BY id';

  map(row: Row, ctx: MapCtx): MappedDocument {
    return {
      _id: ctx.ref('judge_problemgroup', row.id)!,
      name: row.name,
      fullName: row.full_name,
      createdAt: null,
      updatedAt: null,
    };
  }
}
