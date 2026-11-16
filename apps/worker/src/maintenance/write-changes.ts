import type { Model } from 'mongoose';
import type { RowChange } from './content-job';

/** Compare-and-set of every change: the row is written only while each `before` column is still what the scan read, so a user's edit during the run wins. `updatedAt` stays: a re-render is not an edit. */
export async function writeChanges<T>(
  model: Model<T>,
  changes: readonly RowChange[],
): Promise<number> {
  let written = 0;
  for (const { id, before, after } of changes) {
    const result = await model
      .updateOne({ _id: id, ...before }, { $set: after }, { timestamps: false })
      .exec();
    written += result.modifiedCount;
  }
  return written;
}
