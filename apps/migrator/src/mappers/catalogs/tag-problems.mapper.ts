import { Injectable } from '@nestjs/common';
import { LegacySourceService } from '../../legacy-source.service';
import { groupBy, MapCtx, MappedDocument, Mapper } from '../../mapper';

type Row = {
  id: number;
  code: string;
  name: string;
  link: string;
  judge: string | null;
};
type Assignment = { problem_id: number; tag_id: number; assigner_id: number };

@Injectable()
export class TagProblemsMapper implements Mapper<Row> {
  name = 'tag-problems';
  collection = 'tagProblems';
  refTables = ['judge_tagproblem', 'judge_tag', 'judge_profile', 'auth_user'];
  sql = 'SELECT id, code, name, link, judge FROM judge_tagproblem ORDER BY id';
  private assignments = new Map<number, Assignment[]>();

  /** Joined like the `tags` job's skip rule, so an assignment never points at a skipped tag. */
  async prepare(source: LegacySourceService) {
    const rows = await source.query<Assignment>(
      `SELECT td.problem_id, td.tag_id, td.assigner_id FROM judge_tagdata td
       JOIN judge_tag t ON t.id = td.tag_id JOIN judge_taggroup g ON g.id = t.group_id ORDER BY td.id`,
    );
    this.assignments = groupBy(rows, 'problem_id', (row) => row);
  }

  map(row: Row, ctx: MapCtx): MappedDocument {
    return {
      _id: ctx.ref('judge_tagproblem', row.id)!,
      code: row.code,
      name: row.name,
      link: row.link,
      judge: row.judge || null,
      tags: (this.assignments.get(row.id) ?? []).flatMap((assignment) => {
        const assignerId = ctx.refOrNull(
          'judge_profile',
          assignment.assigner_id,
        );
        return assignerId
          ? [{ tagId: ctx.ref('judge_tag', assignment.tag_id)!, assignerId }]
          : [];
      }),
      createdAt: null,
      updatedAt: null,
    };
  }
}
