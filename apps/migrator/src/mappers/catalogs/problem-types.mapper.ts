import { Injectable } from '@nestjs/common';
import { MapCtx, MappedDocument, Mapper } from '../../mapper';

type Row = { id: number; name: string; full_name: string };

@Injectable()
export class ProblemTypesMapper implements Mapper<Row> {
  name = 'problem-types';
  collection = 'problemTypes';
  refTables = ['judge_problemtype'];
  sql = 'SELECT id, name, full_name FROM judge_problemtype ORDER BY id';

  map(row: Row, ctx: MapCtx): MappedDocument {
    return {
      _id: ctx.ref('judge_problemtype', row.id)!,
      name: row.name,
      fullName: row.full_name,
      createdAt: null,
      updatedAt: null,
    };
  }
}
