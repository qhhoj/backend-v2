import { Injectable } from '@nestjs/common';
import { sha256 } from '@libs/auth';
import { LegacySourceService } from '../../legacy-source.service';
import { MapCtx, MappedDocument, Mapper } from '../../mapper';
import { formatOf } from './contest-format';
import { CONTEST_RELATION_TABLES, ContestRelations } from './contest-relations';
import { CONTESTS_SQL, ContestRow } from './contest-row';

const MICROSECONDS = 1_000_000;
const hashOrNull = (code: string | null) => (code ? sha256(code) : null);

@Injectable()
export class ContestsMapper implements Mapper<ContestRow> {
  name = 'contests';
  collection = 'contests';
  refTables = ['judge_contest', ...CONTEST_RELATION_TABLES];
  sql = CONTESTS_SQL;
  private readonly relations = new ContestRelations();

  async prepare(source: LegacySourceService) {
    await this.relations.load(source);
  }

  map(row: ContestRow, ctx: MapCtx): MappedDocument {
    return {
      _id: ctx.ref('judge_contest', row.id)!,
      ...this.textAndTime(row, ctx),
      ...this.access(row, ctx),
      ...this.board(row, ctx),
      ...formatOf(row, ctx),
      ...this.relations.fieldsOf(row.id, ctx),
      createdAt: null,
      updatedAt: null,
    };
  }

  private textAndTime(row: ContestRow, ctx: MapCtx) {
    const seconds =
      row.time_limit == null
        ? 0
        : Math.round(Number(row.time_limit) / MICROSECONDS);
    return {
      key: row.key,
      name: row.name,
      description: row.description ?? '',
      descriptionHtml: ctx.render(
        row.description,
        'problem',
        `judge_contest:${row.id}`,
      ),
      summary: row.summary ?? '',
      startTime: ctx.date(row.start_time),
      endTime: ctx.date(row.end_time),
      timeLimit: seconds > 0 ? seconds : null,
      registrationStart: ctx.date(row.registration_start),
      registrationEnd: ctx.date(row.registration_end),
      frozenLastMinutes: Number(row.frozen_last_minutes ?? 0),
      lockedAfter: ctx.date(row.locked_after),
      dataPreparedAt: ctx.date(row.data_last_downloaded),
    };
  }

  private access(row: ContestRow, ctx: MapCtx) {
    if (row.og_image || row.logo_override_image)
      ctx.report(
        `judge_contest:${row.id} og_image/logo_override_image not migrated`,
      );
    return {
      disallowVirtual: ctx.bool(row.disallow_virtual),
      isVisible: ctx.bool(row.is_visible),
      isPrivate: ctx.bool(row.is_private),
      isOrganizationPrivate: ctx.bool(row.is_organization_private),
      accessCodeHash: hashOrNull(row.access_code),
      rankingAccessCodeHash: hashOrNull(row.ranking_access_code),
      isRated: ctx.bool(row.is_rated),
      rateAll: ctx.bool(row.rate_all),
      ratingFloor: row.rating_floor,
      ratingCeiling: row.rating_ceiling,
    };
  }

  private board(row: ContestRow, ctx: MapCtx) {
    if (row.problem_label_script)
      ctx.report(`judge_contest:${row.id} Lua label script → alpha`);
    return {
      scoreboardVisibility: row.scoreboard_visibility,
      scoreboardCacheTimeout: Number(row.scoreboard_cache_timeout ?? 0),
      showSubmissionList: ctx.bool(row.show_submission_list),
      pointsPrecision: Number(row.points_precision ?? 3),
      runPretestsOnly: ctx.bool(row.run_pretests_only),
      hideProblemTags: ctx.bool(row.hide_problem_tags),
      hideProblemAuthors: ctx.bool(row.hide_problem_authors),
      showShortDisplay: ctx.bool(row.show_short_display),
      pushAnnouncements: ctx.bool(row.push_announcements),
      labelStyle: row.problem_label_script ? 'alpha' : 'numeric',
      userCount: Number(row.user_count ?? 0),
      virtualCount: Number(row.virtual_count ?? 0),
    };
  }
}
