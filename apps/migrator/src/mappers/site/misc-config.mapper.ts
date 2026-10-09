import { Injectable } from '@nestjs/common';
import { MapCtx, MappedDocument, Mapper } from '../../mapper';

type Row = { id: number; key: string; value: string };

const DJANGO_TEMPLATE = /\{%|\{\{/;

@Injectable()
export class MiscConfigMapper implements Mapper<Row> {
  name = 'misc-config';
  collection = 'miscConfig';
  refTables = ['judge_miscconfig'];
  /** Legacy kept duplicate keys and read the last one; v2 keys are unique. */
  sql = `SELECT id, \`key\`, value FROM judge_miscconfig
    WHERE id IN (SELECT MAX(id) FROM judge_miscconfig GROUP BY \`key\`) ORDER BY id`;

  map(row: Row, ctx: MapCtx): MappedDocument {
    if (DJANGO_TEMPLATE.test(row.value ?? ''))
      ctx.report(`judge_miscconfig key "${row.key}" holds a Django template`);
    return {
      _id: ctx.ref('judge_miscconfig', row.id)!,
      key: row.key,
      value: row.value ?? '',
      createdAt: null,
      updatedAt: null,
    };
  }
}
