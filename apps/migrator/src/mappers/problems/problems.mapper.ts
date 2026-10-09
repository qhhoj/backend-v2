import { Injectable } from '@nestjs/common';
import { PROBLEM_LIMITS } from '@libs/database';
import type { RenderStyle } from '@libs/render';
import { LegacySourceService } from '../../legacy-source.service';
import { MapCtx, MappedDocument, Mapper, withoutFields } from '../../mapper';
import { importedProblem } from '../imported-rows';
import { mediaUrlOf } from './media-url';
import { ProblemDataSource } from './problem-data';
import { ProblemRelations, RELATION_TABLES } from './problem-relations';
import { PROBLEMS_SQL, ProblemRow } from './problem-row';
import { ProblemStatements } from './problem-statements';

/** Owned by `recomputeProblem` (D3). */
const RECOMPUTED = ['userCount', 'acRate', 'updatedAt'];

@Injectable()
export class ProblemsMapper implements Mapper<ProblemRow> {
  name = 'problems';
  collection = 'problems';
  refTables = [
    'judge_problem',
    'judge_problemgroup',
    'judge_license',
    ...RELATION_TABLES,
  ];
  sql = PROBLEMS_SQL;
  private readonly relations = new ProblemRelations();
  private readonly statements = new ProblemStatements();
  private readonly data = new ProblemDataSource();
  /** Legacy ids the job imports: a mirror may only point at one of these. */
  private imported = new Set<number>();

  async prepare(source: LegacySourceService) {
    this.imported = new Set(
      (
        await source.query<{ id: number }>(
          `SELECT p.id FROM judge_problem p ${importedProblem('p')}`,
        )
      ).map((row) => Number(row.id)),
    );
    await this.relations.load(source);
    await this.statements.load(source);
    await this.data.load(source);
  }

  map(row: ProblemRow, ctx: MapCtx): MappedDocument | null {
    const groupId = ctx.refOrNull('judge_problemgroup', row.group_id);
    if (!groupId) {
      ctx.report(`skipped judge_problem:${row.id} (group missing)`);
      return null;
    }
    const style: RenderStyle = ctx.bool(row.is_full_markup)
      ? 'problem-full'
      : 'problem';
    return {
      _id: ctx.ref('judge_problem', row.id)!,
      ...this.scalarFields(row, ctx),
      groupId,
      licenseId: ctx.refOrNull('judge_license', row.license_id),
      suggester: ctx.refOrNull('judge_profile', row.suggester_id),
      mirrorOf: this.importedRef(row.mirror_of_id, ctx),
      mirrorRoot: this.importedRef(row.mirror_root_id, ctx),
      ...this.relations.fieldsOf(row.id, ctx),
      descriptionHtml: ctx.render(
        row.description,
        style,
        `judge_problem:${row.id}`,
      ),
      translations: this.statements.translationsOf(row.id, style, ctx),
      solution: this.statements.solutionOf(row.id, ctx),
      data: this.data.dataOf({ id: row.id, code: row.code }, ctx),
    };
  }

  normalize(doc: MappedDocument) {
    return withoutFields(doc, RECOMPUTED);
  }

  /** Ruling: legacy points outside the v2 bounds are clamped and each clamped problem is reported. */
  private clampedPoints(row: ProblemRow, ctx: MapCtx): number {
    const { min, max } = PROBLEM_LIMITS.points;
    const old = Number(row.points);
    const clamped = Math.min(max, Math.max(min, old));
    if (clamped !== old)
      ctx.report(`clamped points judge_problem:${row.id} ${old} -> ${clamped}`);
    return clamped;
  }

  private importedRef(id: number | null, ctx: MapCtx) {
    if (id == null) return null;
    if (this.imported.has(Number(id))) return ctx.ref('judge_problem', id);
    ctx.report(`dangling judge_problem:${id}`);
    return null;
  }

  private scalarFields(row: ProblemRow, ctx: MapCtx) {
    return {
      code: row.code,
      name: row.name,
      source: row.source ?? '',
      summary: row.summary ?? '',
      description: row.description ?? '',
      timeLimit: Number(row.time_limit),
      memoryLimit: Number(row.memory_limit),
      points: this.clampedPoints(row, ctx),
      partial: ctx.bool(row.partial),
      isPublic: ctx.bool(row.is_public),
      date: ctx.date(row.date),
      isOrganizationPrivate: ctx.bool(row.is_organization_private),
      isManuallyManaged: ctx.bool(row.is_manually_managed),
      isFullMarkup: ctx.bool(row.is_full_markup),
      pdfStatementUrl: row.pdf_url || null,
      materialUrl: mediaUrlOf(row.problem_material),
      ogImage: row.og_image ?? '',
      submissionSourceVisibility: row.submission_source_visibility_mode,
      testcaseVisibility: row.testcase_visibility_mode,
      testcaseResultVisibility: row.testcase_result_visibility_mode,
      allowViewFeedback: ctx.bool(row.allow_view_feedback),
      userCount: Number(row.user_count ?? 0),
      acRate: Number(row.ac_rate ?? 0),
      dataVersion: 0,
      createdAt: ctx.date(row.date),
      updatedAt: ctx.date(row.date),
    };
  }
}
