import { Injectable } from '@nestjs/common';
import { mediaUrl } from '../../legacy-env';
import { MapCtx, MappedDocument, Mapper } from '../../mapper';
import { importedSubmission } from '../imported-rows';

type Row = { id: number; submission_id: number; source: string };

const LEGACY_FILE_PREFIX = '/submission_file/';

/** Legacy file-only source (a site path v2 does not serve) as the media URL the bridge makes absolute. */
export const fileSourceUrl = (source: string): string =>
  source.startsWith(LEGACY_FILE_PREFIX) ? `${mediaUrl()}${source}` : source;

@Injectable()
export class SubmissionSourcesMapper implements Mapper<Row> {
  name = 'submission-sources';
  collection = 'submissionSources';
  refTables = ['judge_submission'];
  /** STRAIGHT_JOIN keeps the source table as the driver, as in the submissions job. */
  sql = `SELECT STRAIGHT_JOIN ss.id, ss.submission_id, ss.source FROM judge_submissionsource ss
    JOIN judge_submission s ON s.id = ss.submission_id ${importedSubmission('s')} ORDER BY ss.id`;

  map(row: Row, ctx: MapCtx): MappedDocument {
    return {
      _id: ctx.ref('judge_submission', row.submission_id)!,
      source: fileSourceUrl(row.source ?? ''),
      createdAt: null,
      updatedAt: null,
    };
  }
}
