import {
  Language,
  LanguageSchema,
  Problem,
  ProblemSchema,
  uuidStr,
} from '@libs/database';
import type { Connection } from 'mongoose';

export interface PruneSummary {
  keptLanguages: string[];
  prunedLanguages: string[];
  /** Keep keys that name no Language row: a typo here would otherwise prune a language the fleet runs. */
  unknownKeep: string[];
  problemsChanged: number;
  languagesDisabled: number;
}

interface PruneOptions {
  keep: string[];
  dryRun: boolean;
}

interface LanguageRow {
  _id: string;
  key: string;
}

export function parseKeep(value: string): string[] {
  const keys = [
    ...new Set(
      value
        .split(',')
        .map((key) => key.trim().toUpperCase())
        .filter(Boolean),
    ),
  ];
  if (!keys.length) throw new Error('--keep needs at least one language key');
  return keys;
}

async function splitLanguages(connection: Connection, keep: Set<string>) {
  const found = await connection
    .model<Language>(Language.name, LanguageSchema)
    .find({}, { key: 1 })
    .lean();
  const rows: LanguageRow[] = found.map((row) => ({
    _id: uuidStr(row._id),
    key: row.key,
  }));
  rows.sort((left, right) => left.key.localeCompare(right.key));
  return {
    kept: rows.filter((row) => keep.has(row.key.toUpperCase())),
    pruned: rows.filter((row) => !keep.has(row.key.toUpperCase())),
  };
}

async function applyPrune(
  connection: Connection,
  prunedIds: string[],
  dryRun: boolean,
) {
  const problems = connection.model<Problem>(Problem.name, ProblemSchema);
  const languages = connection.model<Language>(Language.name, LanguageSchema);
  const problemFilter = { allowedLanguages: { $in: prunedIds } };
  const languageFilter = { _id: { $in: prunedIds }, includeInProblem: true };
  if (dryRun)
    return {
      problemsChanged: await problems.countDocuments(problemFilter),
      languagesDisabled: await languages.countDocuments(languageFilter),
    };
  const changed = await problems.updateMany(problemFilter, {
    $pull: { allowedLanguages: { $in: prunedIds } },
  });
  const disabled = await languages.updateMany(languageFilter, {
    $set: { includeInProblem: false },
  });
  return {
    problemsChanged: changed.modifiedCount,
    languagesDisabled: disabled.modifiedCount,
  };
}

/** Judge-v2 cutover: only languages the judge fleet runs stay allowed; the other rows stay for history (past submissions), disabled. Idempotent. */
export async function pruneLanguages(
  connection: Connection,
  { keep, dryRun }: PruneOptions,
): Promise<PruneSummary> {
  const wanted = new Set(keep.map((key) => key.toUpperCase()));
  const { kept, pruned } = await splitLanguages(connection, wanted);
  const known = new Set(kept.map((row) => row.key.toUpperCase()));
  const counts = pruned.length
    ? await applyPrune(
        connection,
        pruned.map((row) => row._id),
        dryRun,
      )
    : { problemsChanged: 0, languagesDisabled: 0 };
  return {
    keptLanguages: kept.map((row) => row.key),
    prunedLanguages: pruned.map((row) => row.key),
    unknownKeep: [...wanted].filter((key) => !known.has(key)),
    ...counts,
  };
}
