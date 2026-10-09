import { Injectable } from '@nestjs/common';
import { MapCtx, MappedDocument, Mapper } from '../../mapper';

type Row = { id: number; code: string; name: string; group_id: number };

@Injectable()
export class TagsMapper implements Mapper<Row> {
  name = 'tags';
  collection = 'tags';
  refTables = ['judge_tag', 'judge_taggroup'];
  sql = 'SELECT id, code, name, group_id FROM judge_tag ORDER BY id';

  map(row: Row, ctx: MapCtx): MappedDocument | null {
    const groupId = ctx.refOrNull('judge_taggroup', row.group_id);
    if (!groupId) {
      ctx.report(`skipped judge_tag:${row.id} (group missing)`);
      return null;
    }
    return {
      _id: ctx.ref('judge_tag', row.id)!,
      code: row.code,
      name: row.name,
      groupId,
      createdAt: null,
      updatedAt: null,
    };
  }
}
