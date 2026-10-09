import { Injectable } from '@nestjs/common';
import { MapCtx, MappedDocument, Mapper } from '../../mapper';

type Row = { id: number; code: string; name: string };

@Injectable()
export class TagGroupsMapper implements Mapper<Row> {
  name = 'tag-groups';
  collection = 'tagGroups';
  refTables = ['judge_taggroup'];
  sql = 'SELECT id, code, name FROM judge_taggroup ORDER BY id';

  map(row: Row, ctx: MapCtx): MappedDocument {
    return {
      _id: ctx.ref('judge_taggroup', row.id)!,
      code: row.code,
      name: row.name,
      createdAt: null,
      updatedAt: null,
    };
  }
}
