import { Injectable } from '@nestjs/common';
import { MapCtx, MappedDocument, Mapper } from '../../mapper';
import { jsRegex } from './navigation-regex';

type Row = {
  id: number;
  order: number;
  key: string;
  label: string;
  path: string;
  regex: string;
  parent_id: number | null;
  hidden: number;
};

@Injectable()
export class NavigationMapper implements Mapper<Row> {
  name = 'navigation';
  collection = 'navigationBar';
  refTables = ['judge_navigationbar'];
  sql =
    'SELECT id, `order`, `key`, label, path, regex, parent_id, hidden FROM judge_navigationbar ORDER BY id';

  map(row: Row, ctx: MapCtx): MappedDocument {
    const where = `judge_navigationbar:${row.id}`;
    const compiled = jsRegex(row.regex ?? '');
    if (!compiled) ctx.report(`${where} regex dropped`);
    else if (compiled.converted) ctx.report(`${where} regex converted`);
    return {
      _id: ctx.ref('judge_navigationbar', row.id)!,
      key: row.key,
      label: row.label,
      path: row.path,
      regex: compiled?.regex ?? '',
      hidden: ctx.bool(row.hidden),
      order: Number(row.order),
      parentId: ctx.refOrNull('judge_navigationbar', row.parent_id),
      createdAt: null,
      updatedAt: null,
    };
  }
}
