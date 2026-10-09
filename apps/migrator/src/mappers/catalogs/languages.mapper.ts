import { Injectable } from '@nestjs/common';
import { MapCtx, MappedDocument, Mapper } from '../../mapper';

type Row = {
  id: number;
  key: string;
  name: string;
  short_name: string | null;
  common_name: string;
  ace: string;
  pygments: string;
  template: string;
  info: string;
  description: string;
  extension: string;
  file_only: number;
  file_size_limit: number;
  include_in_problem: number;
};

@Injectable()
export class LanguagesMapper implements Mapper<Row> {
  name = 'languages';
  collection = 'languages';
  refTables = ['judge_language'];
  sql = `SELECT id, \`key\`, name, short_name, common_name, ace, pygments, template, info, description, extension,
    file_only, file_size_limit, include_in_problem FROM judge_language ORDER BY id`;

  map(row: Row, ctx: MapCtx): MappedDocument {
    return {
      _id: ctx.ref('judge_language', row.id)!,
      key: row.key,
      name: row.name,
      shortName: row.short_name || null,
      commonName: row.common_name,
      ace: row.ace,
      pygments: row.pygments,
      template: row.template ?? '',
      info: row.info ?? '',
      description: row.description ?? '',
      extension: row.extension,
      fileOnly: ctx.bool(row.file_only),
      fileSizeLimit: Number(row.file_size_limit ?? 0),
      includeInProblem: ctx.bool(row.include_in_problem),
      createdAt: null,
      updatedAt: null,
    };
  }
}
