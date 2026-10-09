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
  /** Codes of problems the prune leaves with no allowed language: nobody can submit to them until an editor adds one. */
  emptiedProblems: string[];
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

/** Problems whose every allowed language is pruned (read before the prune, so a re-run reports none). */
async function emptiedBy(
  connection: Connection,
  prunedIds: string[],
): Promise<string[]> {
  const problems = connection.model<Problem>(Problem.name, ProblemSchema);
  const rows = await problems
    .find(
      {
        allowedLanguages: {
          $ne: [],
          $not: { $elemMatch: { $nin: prunedIds } },
        },
      },
      { code: 1 },
    )
    .sort({ code: 1 })
    .lean();
  return rows.map((row) => row.code);
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
  const prunedIds = pruned.map((row) => row._id);
  const emptiedProblems = prunedIds.length
    ? await emptiedBy(connection, prunedIds)
    : [];
  const counts = prunedIds.length
    ? await applyPrune(connection, prunedIds, dryRun)
    : { problemsChanged: 0, languagesDisabled: 0 };
  return {
    keptLanguages: kept.map((row) => row.key),
    prunedLanguages: pruned.map((row) => row.key),
    unknownKeep: [...wanted].filter((key) => !known.has(key)),
    ...counts,
    emptiedProblems,
  };
}
