import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Problem, uuidStr } from '@libs/database';
import type { Model } from 'mongoose';

/** One uploaded file of a problem as read: the write only lands while both are still these. */
export interface StoredFile {
  url: string | null;
  bytes: number | null;
}

export interface ProblemRef {
  id: string;
  code: string;
  /** `dataBytes` as read; the write only lands while it is still this. */
  dataBytes: number | null;
  pdfStatement: StoredFile;
  material: StoredFile;
}

export interface MeasuredSize {
  ref: ProblemRef;
  bytes: number;
  pdfStatementBytes: number;
  materialBytes: number;
}

interface ProblemRow {
  _id: string;
  code: string;
  dataBytes?: number;
  pdfStatementUrl?: string | null;
  pdfStatementBytes?: number;
  materialUrl?: string | null;
  materialBytes?: number;
}

const storedFile = (url?: string | null, bytes?: number): StoredFile => ({
  url: url ?? null,
  bytes: bytes ?? null,
});

/** Reads every problem including deleted and purged ones (the allow-listed `S` reader of the structural spec: the directories are on disk whatever the state). */
@Injectable()
export class ProblemDataBytesRepository {
  constructor(
    @InjectModel(Problem.name) private readonly problems: Model<Problem>,
  ) {}

  /** `_id`-ordered batches of refs; never loads statements or test data. */
  async *batches(size: number): AsyncGenerator<ProblemRef[]> {
    let after: string | null = null;
    for (;;) {
      const rows: ProblemRow[] = await this.problems
        .find(after === null ? {} : { _id: { $gt: after } }, {
          code: 1,
          dataBytes: 1,
          pdfStatementUrl: 1,
          pdfStatementBytes: 1,
          materialUrl: 1,
          materialBytes: 1,
        })
        .sort({ _id: 1 })
        .limit(size)
        .lean()
        .exec();
      if (!rows.length) return;
      yield rows.map((row) => ({
        id: uuidStr(row._id),
        code: row.code,
        dataBytes: row.dataBytes ?? null,
        pdfStatement: storedFile(row.pdfStatementUrl, row.pdfStatementBytes),
        material: storedFile(row.materialUrl, row.materialBytes),
      }));
      after = uuidStr(rows[rows.length - 1]._id);
    }
  }

  /** Compare-and-set per meter against the values read: a data write or an upload that set its own size meanwhile is fresher than this measurement and wins, without blocking the other meters. */
  async setSizes(sizes: readonly MeasuredSize[]): Promise<void> {
    if (!sizes.length) return;
    await this.problems.bulkWrite(
      sizes.flatMap(({ ref, bytes, pdfStatementBytes, materialBytes }) => [
        {
          updateOne: {
            filter: { _id: ref.id, dataBytes: ref.dataBytes },
            update: { $set: { dataBytes: bytes } },
          },
        },
        fileUpdate(ref.id, 'pdfStatement', ref.pdfStatement, pdfStatementBytes),
        fileUpdate(ref.id, 'material', ref.material, materialBytes),
      ]),
    );
  }
}

const fileUpdate = (
  id: string,
  file: 'pdfStatement' | 'material',
  read: StoredFile,
  bytes: number,
) => ({
  updateOne: {
    filter: {
      _id: id,
      [`${file}Url`]: read.url,
      [`${file}Bytes`]: read.bytes,
    },
    update: { $set: { [`${file}Bytes`]: bytes } },
  },
});
