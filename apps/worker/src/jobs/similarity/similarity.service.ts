import { Injectable, Logger } from '@nestjs/common';
import { uuidStr } from '@libs/database';
import { SIMILARITY_DEADLINE_MS } from '@libs/judging';
import type {
  SimilarityError,
  SimilarityGroup,
  SimilarityLimits,
  SimilarityRun,
  SimilarityUnsupported,
} from '@libs/database';
import { SimilarityEngine, SimilarityEngineError } from './similarity-engine';
import type { EnginePair, EngineSubmission } from './similarity-engine';
import { familyOf } from './similarity-languages';
import type { SimilarityFamily } from './similarity-languages';
import {
  keepStrongest,
  toStoredPairs,
  withKeptPairCounts,
} from './similarity-outcome';
import type { GroupComparison } from './similarity-outcome';
import { SimilarityRepository } from './similarity.repository';
import type {
  ProblemScope,
  RunOutcome,
  StoredPair,
  SubmissionRow,
} from './similarity.repository';

/** Sources over this many bytes are skipped (the spec's 64 KiB). */
const SIMILARITY_MAX_SOURCE_BYTES = 64 * 1024;
/** Sources are read this many at a time. */
const SOURCE_CHUNK = 200;

interface FamilyLanguages {
  family: SimilarityFamily;
  languageIds: string[];
}
interface LanguageSplit {
  /** One entry per engine family (C, C++03..C++20 share one). */
  families: FamilyLanguages[];
  /** Language ids by common name, for languages with no grammar. */
  unsupported: Map<string, string[]>;
}
interface PreparedSources {
  submissions: EngineSubmission[];
  skippedEmpty: number;
  skippedTooLarge: number;
}
/** A group ready for the engine: its summary so far and the sources to send. */
interface PreparedGroup {
  group: SimilarityGroup;
  submissions: EngineSubmission[];
}

const classifySource = (
  source: string,
): 'empty' | 'tooLarge' | 'comparable' => {
  if (source.trim() === '') return 'empty';
  if (Buffer.byteLength(source) > SIMILARITY_MAX_SOURCE_BYTES)
    return 'tooLarge';
  return 'comparable';
};

/** The time left before the run's deadline; a run past it fails as a whole. */
const timeLeftOrThrow = (deadlineAt: number): number => {
  const timeoutMs = deadlineAt - Date.now();
  if (timeoutMs <= 0) throw new SimilarityEngineError('deadline');
  return timeoutMs;
};

/** Only the code is stored: a raw message can hold paths or source text. */
const failureCodeOf = (error: unknown): SimilarityError =>
  error instanceof SimilarityEngineError ? error.code : 'internal_error';

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

@Injectable()
export class SimilarityService {
  private readonly logger = new Logger(SimilarityService.name);

  constructor(
    private readonly repository: SimilarityRepository,
    private readonly engine: SimilarityEngine,
  ) {}

  /** A comparison that fails is recorded on the run and the job still completes: retrying the same sources would fail the same way. */
  async run(runId: string): Promise<void> {
    const run = await this.repository.claim(runId);
    if (!run) return this.failStalledAttempt(runId);
    try {
      const deadlineAt = Date.now() + SIMILARITY_DEADLINE_MS;
      const outcome = await this.compareScope(run, deadlineAt);
      if (!(await this.repository.finish(run, outcome)))
        this.logger.warn(
          `Similarity run ${runId} was no longer running (released, or failed by a redelivery); its results were dropped`,
        );
    } catch (error) {
      if (!(error instanceof SimilarityEngineError))
        this.logger.error(
          `Similarity run ${runId} failed: ${messageOf(error)}`,
        );
      await this.repository.markFailed(runId, failureCodeOf(error));
    }
  }

  /** For a job that died outside `run` (stalled, killed). */
  markFailed(runId: string, reason: SimilarityError): Promise<void> {
    return this.repository.markFailed(runId, reason);
  }

  /**
   * The run is not queued: gone, finished, or `running` from an attempt whose worker died (BullMQ redelivers a stalled job).
   * One job per run and one job at a time mean nobody works on that leftover, so it is failed now rather than block its scope
   * until the api's stale-run release. Should the first attempt be alive after all, its `finish` finds the run no longer running
   * and writes nothing. `markFailed` touches active runs only, so a finished or unknown run is left alone.
   */
  private failStalledAttempt(runId: string): Promise<void> {
    return this.repository.markFailed(runId, 'internal_error');
  }

  private async compareScope(
    run: SimilarityRun,
    deadlineAt: number,
  ): Promise<RunOutcome> {
    const languages = await this.splitLanguages();
    const problemScopes = await this.repository.problemScopes(run);
    const groups: SimilarityGroup[] = [];
    let strongestPairs: StoredPair[] = [];
    for (const scope of problemScopes)
      for (const familyLanguages of languages.families) {
        const comparison = await this.compareGroup(
          run,
          scope,
          familyLanguages,
          deadlineAt,
        );
        if (!comparison) continue;
        groups.push(comparison.group);
        // Trimmed after every group, so a run holds about maxPairs pairs however many groups its scope has.
        strongestPairs = keepStrongest(
          strongestPairs,
          comparison.pairs,
          run.limits.maxPairs,
        );
      }
    return {
      groups: withKeptPairCounts(groups, strongestPairs),
      pairs: strongestPairs,
      unsupported: await this.countUnsupported(
        problemScopes,
        languages.unsupported,
      ),
    };
  }

  /** One problem in one language family; null when it has no eligible submission. */
  private async compareGroup(
    run: SimilarityRun,
    scope: ProblemScope,
    familyLanguages: FamilyLanguages,
    deadlineAt: number,
  ): Promise<GroupComparison | null> {
    const prepared = await this.prepareGroup(
      run.limits,
      scope,
      familyLanguages,
    );
    if (!prepared) return null;
    const { group, submissions } = prepared;
    const enginePairs = await this.compareOrNullOnEngineFailure(
      run.limits,
      familyLanguages.family,
      submissions,
      timeLeftOrThrow(deadlineAt),
    );
    if (enginePairs)
      return { group, pairs: toStoredPairs(group, enginePairs, submissions) };
    this.logger.warn(
      `Similarity engine failed on run ${uuidStr(run._id)}, problem ${scope.problemId}, family ${group.language}; the group is listed as failed`,
    );
    return { group: { ...group, failed: true }, pairs: [] };
  }

  /** Counts and reads the group's sources; null when it has no eligible submission. */
  private async prepareGroup(
    limits: SimilarityLimits,
    scope: ProblemScope,
    { family, languageIds }: FamilyLanguages,
  ): Promise<PreparedGroup | null> {
    const submissionCount = await this.repository.countRows(scope, languageIds);
    if (submissionCount === 0) return null;
    const rows = await this.repository.submissionRows(
      scope,
      languageIds,
      limits.maxSubmissions,
    );
    const { submissions, skippedEmpty, skippedTooLarge } =
      await this.prepareSources(rows, family);
    const group: SimilarityGroup = {
      problem: scope.problemId,
      language: family.name,
      tokenizer: family.tokenizer,
      submissionCount,
      comparedCount: submissions.length,
      skippedEmpty,
      skippedTooLarge,
      truncated: submissionCount > limits.maxSubmissions,
      pairCount: 0,
      failed: false,
    };
    return { group, submissions };
  }

  /**
   * Null when the engine failed on this group alone: one odd group (an unusual parse) must not cost the whole run.
   * Every other error propagates and fails the run: a deadline (every later group would hit it too) or a worker shutdown.
   */
  private async compareOrNullOnEngineFailure(
    limits: SimilarityLimits,
    family: SimilarityFamily,
    submissions: EngineSubmission[],
    timeoutMs: number,
  ): Promise<EnginePair[] | null> {
    try {
      return await this.engine.compare({
        family,
        submissions,
        minSimilarity: limits.minPercent / 100,
        maxPairs: limits.maxPairs,
        timeoutMs,
      });
    } catch (error) {
      const isEngineFailure =
        error instanceof SimilarityEngineError &&
        error.code === 'engine_failed';
      if (!isEngineFailure) throw error;
      return null;
    }
  }

  /** Judge languages grouped by engine family, the rest by common name. */
  private async splitLanguages(): Promise<LanguageSplit> {
    const families = new Map<string, FamilyLanguages>();
    const unsupported = new Map<string, string[]>();
    for (const { id, commonName } of await this.repository.languages()) {
      const family = familyOf(commonName);
      if (!family) {
        const languageIds = unsupported.get(commonName) ?? [];
        languageIds.push(id);
        unsupported.set(commonName, languageIds);
        continue;
      }
      const entry = families.get(family.name) ?? { family, languageIds: [] };
      entry.languageIds.push(id);
      families.set(family.name, entry);
    }
    return { families: [...families.values()], unsupported };
  }

  /** Per language without a grammar, its eligible submissions over every problem of the scope; languages with none are left out. */
  private async countUnsupported(
    problemScopes: ProblemScope[],
    unsupported: Map<string, string[]>,
  ): Promise<SimilarityUnsupported[]> {
    const counted: SimilarityUnsupported[] = [];
    for (const [language, languageIds] of unsupported) {
      let submissionCount = 0;
      for (const scope of problemScopes)
        submissionCount += await this.repository.countRows(scope, languageIds);
      if (submissionCount > 0) counted.push({ language, submissionCount });
    }
    return counted;
  }

  /** Read in chunks so a capped group of thousands never holds a single huge query. */
  private async prepareSources(
    rows: SubmissionRow[],
    family: SimilarityFamily,
  ): Promise<PreparedSources> {
    const prepared: PreparedSources = {
      submissions: [],
      skippedEmpty: 0,
      skippedTooLarge: 0,
    };
    for (let start = 0; start < rows.length; start += SOURCE_CHUNK) {
      const chunk = rows.slice(start, start + SOURCE_CHUNK);
      const sources = await this.repository.sourcesOf(
        chunk.map((row) => row.id),
      );
      for (const row of chunk) {
        const source = sources.get(row.id) ?? '';
        const kind = classifySource(source);
        if (kind === 'empty') prepared.skippedEmpty++;
        else if (kind === 'tooLarge') prepared.skippedTooLarge++;
        else
          prepared.submissions.push({
            id: row.id,
            user: row.user,
            source: family.prepare(source),
          });
      }
    }
    return prepared;
  }
}
