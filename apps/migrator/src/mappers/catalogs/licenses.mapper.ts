import { Injectable } from '@nestjs/common';
import { MapCtx, MappedDocument, Mapper } from '../../mapper';

type Row = {
  id: number;
  key: string;
  link: string;
  name: string;
  display: string;
  icon: string;
  text: string;
};

@Injectable()
export class LicensesMapper implements Mapper<Row> {
  name = 'licenses';
  collection = 'licenses';
  refTables = ['judge_license'];
  sql =
    'SELECT id, `key`, link, name, display, icon, text FROM judge_license ORDER BY id';

  map(row: Row, ctx: MapCtx): MappedDocument {
    return {
      _id: ctx.ref('judge_license', row.id)!,
      key: row.key,
      name: row.name,
      link: row.link ?? '',
      display: row.display ?? '',
      icon: row.icon ?? '',
      text: row.text ?? '',
      createdAt: null,
      updatedAt: null,
    };
  }
}
