import { Injectable } from '@nestjs/common';
import { CsvRankingError, parseOfficialRanking } from '@libs/contests';
import { MapCtx, MappedDocument, Mapper } from '../../mapper';

interface Row {
  id: number;
  csv_ranking: string;
}

/** Legacy `Contest.csv_ranking` kept apart from the contest (up to 1 MiB), one document per contest. */
@Injectable()
export class ContestOfficialRankingsMapper implements Mapper<Row> {
  name = 'contest-official-rankings';
  collection = 'contestOfficialRankings';
  refTables = ['judge_contest'];
  sql =
    "SELECT id, csv_ranking FROM judge_contest WHERE csv_ranking IS NOT NULL AND csv_ranking <> '' ORDER BY id";

  map(row: Row, ctx: MapCtx): MappedDocument | null {
    try {
      const { problems, rows } = parseOfficialRanking(row.csv_ranking);
      return {
        _id: ctx.ref('judge_contest', row.id)!,
        url: null,
        problems,
        rows,
        createdAt: null,
        updatedAt: null,
      };
    } catch (error) {
      if (!(error instanceof CsvRankingError)) throw error;
      ctx.report(
        `skipped csv_ranking of judge_contest:${row.id} (${error.message})`,
      );
      return null;
    }
  }
}
