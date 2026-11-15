import type { Model, PipelineStage, Query, Schema } from 'mongoose';

/** What an editor still has to do on a new problem; stored on the problem so the admin list can show and filter it without reading the test data. */
export interface ProblemSetupFlags {
  hasStatement: boolean;
  hasTests: boolean;
  hasPoints: boolean;
}

const isWritten = (path: string) => ({
  $ne: [{ $trim: { input: { $ifNull: [path, ''] } } }, ''],
});

/** An external-judge problem keeps its tests and points on the remote OJ. */
const isExternal = { $ne: [{ $ifNull: ['$externalJudge', null] }, null] };

const hasCaseOfType = {
  $anyElementTrue: [
    {
      $map: {
        input: { $ifNull: ['$data.cases', []] },
        as: 'testCase',
        in: { $eq: ['$$testCase.type', 'C'] },
      },
    },
  ],
};

/** Points of the scored cases: a batch start ('S') scores its points, a case inside a batch ('C' before the next 'E') scores none, a lone 'C' scores its own. */
const scoredReduction = {
  $reduce: {
    input: { $ifNull: ['$data.cases', []] },
    initialValue: { isInBatch: false, total: 0 },
    in: {
      isInBatch: {
        $switch: {
          branches: [
            { case: { $eq: ['$$this.type', 'S'] }, then: true },
            { case: { $eq: ['$$this.type', 'E'] }, then: false },
          ],
          default: '$$value.isInBatch',
        },
      },
      total: {
        $add: [
          '$$value.total',
          {
            $cond: [
              {
                $or: [
                  { $eq: ['$$this.type', 'S'] },
                  {
                    $and: [
                      { $eq: ['$$this.type', 'C'] },
                      { $not: ['$$value.isInBatch'] },
                    ],
                  },
                ],
              },
              { $ifNull: ['$$this.points', 0] },
              0,
            ],
          },
        ],
      },
    },
  },
};

const scoredTotal = {
  $let: { vars: { scored: scoredReduction }, in: '$$scored.total' },
};

/**
 * Update pipeline that recomputes `setup` and `isSetupUnfinished` from the stored statement, translations and test data.
 * The rule mirrors the frontend's setup checks: a written statement in any slot or a PDF statement, at least one 'C' case, scored points above 0 (an external-judge problem counts as having both).
 */
export const SETUP_REFRESH_PIPELINE: PipelineStage[] = [
  {
    $set: {
      setup: {
        hasStatement: {
          $or: [
            isWritten('$description'),
            isWritten('$pdfStatementUrl'),
            {
              $anyElementTrue: [
                {
                  $map: {
                    input: { $ifNull: ['$translations', []] },
                    as: 'translation',
                    in: isWritten('$$translation.description'),
                  },
                },
              ],
            },
          ],
        },
        hasTests: { $or: [isExternal, hasCaseOfType] },
        hasPoints: {
          $or: [
            isExternal,
            { $and: [hasCaseOfType, { $gt: [scoredTotal, 0] }] },
          ],
        },
      },
    },
  },
  {
    $set: {
      // `hasPoints` implies `hasTests`.
      isSetupUnfinished: {
        $not: [{ $and: ['$setup.hasStatement', '$setup.hasPoints'] }],
      },
    },
  },
] as PipelineStage[];

const SETUP_FIELDS =
  /^(description|pdfStatementUrl|translations|data|externalJudge)(\.|$)/;

function touchesSetup(update: unknown): boolean {
  if (!update || Array.isArray(update)) return false;
  return Object.values(update as Record<string, unknown>).some(
    (operand) =>
      operand !== null &&
      typeof operand === 'object' &&
      Object.keys(operand).some((path) => SETUP_FIELDS.test(path)),
  );
}

/**
 * Keeps `setup` current after every write that can change it, in one place for the api and the worker:
 * a saved problem, and `updateOne` by `_id` that sets or pushes the statement, a translation or the test data.
 * The refresh reads the stored document, so a write that carries only one slot still gets the right flags.
 */
export function keepSetupFlagsCurrent(schema: Schema): void {
  schema.post('save', async function (doc) {
    await (doc.constructor as Model<unknown>).updateOne(
      { _id: doc._id },
      SETUP_REFRESH_PIPELINE,
      { session: doc.$session() ?? undefined, timestamps: false },
    );
  });
  schema.post('updateOne', async function (this: Query<unknown, unknown>) {
    const filter = this.getFilter() as { _id?: unknown };
    if (filter._id === undefined || !touchesSetup(this.getUpdate())) return;
    await this.model.updateOne({ _id: filter._id }, SETUP_REFRESH_PIPELINE, {
      session: this.getOptions().session ?? undefined,
      timestamps: false,
    });
  });
}
