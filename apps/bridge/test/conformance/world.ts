import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sha256 } from '@libs/auth';
import { SUBMISSION_PRIORITY } from '@libs/database';
import { requeueUpdate } from '@libs/judging';
import type { BridgeCommandsService } from '@libs/judging';
import type {
  ApiAction,
  Scenario,
  ScenarioSetup,
} from '@libs/judge-proto/conformance/scenario';
import { mismatch } from '@libs/judge-proto/conformance/matcher';
import type { Json } from '@libs/judge-proto/conformance/matcher';
import {
  seedCatalog,
  seedJudge,
  seedProblem,
  seedSubmission,
} from '../fixtures';
import type { BridgeCatalog } from '../fixtures';
import type { BridgeTest } from '../setup';

const SOURCE = 'int main() {}';
/** Where file-only sources are written: `MEDIA_ROOT` is `tmpdir()` in `setupBridgeTest`. */
const SUBMISSION_FILES_DIR = join(tmpdir(), 'submission_file');
/** Directories this suite wrote sources into (one per seeded user, so another suite's files are never touched). */
export const writtenSourceDirs = new Set<string>();

type SetupSubmission = NonNullable<ScenarioSetup['submissions']>[number];
/** Language key -> language id. */
type LanguageIds = Record<string, string>;

const asJson = (value: unknown): Json =>
  JSON.parse(JSON.stringify(value)) as Json;

/** The Mongo side of a scenario: what `setup` seeds, what an `api` step does (as the api would), and the `end_state` check. */
export class ScenarioWorld {
  /** Placeholder (`s1`) -> submission id, and `session:<judge>` -> session id once its Welcome arrived. */
  readonly bindings = new Map<string, string>();

  constructor(
    private readonly bridge: BridgeTest,
    private readonly commands: BridgeCommandsService,
  ) {}

  async seed({ setup }: Scenario): Promise<void> {
    const catalog = await seedCatalog(this.bridge);
    const languages = await this.seedLanguages(catalog);
    // `as` names a second connection of another judge, not a row of its own
    for (const judge of setup.judges.filter((one) => one.as === undefined))
      await seedJudge(this.bridge, judge.name, `${judge.name}-key`, {
        isBlocked: judge.blocked ?? false,
      });
    const problems = await this.seedProblems(catalog, setup, languages);
    for (const submission of setup.submissions ?? [])
      await this.seedSubmission(catalog, submission, {
        problemId: problems.get(submission.problem)!,
        languageId: languages[submission.language ?? 'CPP17'],
      });
  }

  /** CPP17 and PY3 from the catalog, plus the file-only OUTPUT. */
  private async seedLanguages(catalog: BridgeCatalog): Promise<LanguageIds> {
    const output = await this.bridge.languages.create({
      key: 'OUTPUT',
      name: 'Output only',
      commonName: 'Output',
      ace: 'text',
      pygments: 'text',
      extension: 'zip',
      fileOnly: true,
      fileSizeLimit: 10,
    });
    return {
      CPP17: catalog.cpp._id,
      PY3: catalog.python._id,
      OUTPUT: output._id,
    };
  }

  /** Problem code -> problem id. */
  private async seedProblems(
    catalog: BridgeCatalog,
    setup: ScenarioSetup,
    languages: LanguageIds,
  ): Promise<Map<string, string>> {
    const problems = new Map<string, string>();
    for (const problem of setup.problems ?? []) {
      const row = await seedProblem(this.bridge, catalog, {
        code: problem.code,
        dataVersion: problem.dataVersion ?? 0,
        partial: problem.partial ?? false,
        allowedLanguages: Object.values(languages),
      });
      problems.set(problem.code, row._id);
    }
    return problems;
  }

  private async seedSubmission(
    catalog: BridgeCatalog,
    submission: SetupSubmission,
    { problemId, languageId }: { problemId: string; languageId: string },
  ): Promise<void> {
    const source =
      submission.fileBytes === undefined
        ? SOURCE
        : this.writeSourceFile(catalog, submission);
    const row = await seedSubmission(this.bridge, catalog, {
      problem: problemId,
      language: languageId,
      source,
    });
    this.bindings.set(submission.id, row._id);
  }

  /** A file-only upload as the api stores it; returns its `${MEDIA_URL}/submission_file/...` URL. */
  private writeSourceFile(
    catalog: BridgeCatalog,
    { id, problem, fileBytes }: SetupSubmission,
  ): string {
    const directory = join(SUBMISSION_FILES_DIR, problem, catalog.user._id);
    mkdirSync(directory, { recursive: true });
    writtenSourceDirs.add(directory);
    const name = `${id}-${Date.now()}.zip`;
    writeFileSync(join(directory, name), Buffer.alloc(fileBytes ?? 0));
    return `/media/submission_file/${problem}/${catalog.user._id}/${name}`;
  }

  /** What the api does for each action: Mongo first where it writes, then the command. */
  async api(action: ApiAction): Promise<void> {
    const id = (name: string): string => {
      const bound = this.bindings.get(name);
      if (bound === undefined) throw new Error(`unbound api name ${name}`);
      return bound;
    };
    if ('judge' in action) return this.commands.judge(action.judge.map(id));
    if ('abort' in action)
      return this.commands.publish({
        type: 'abort',
        submissionId: id(action.abort),
      });
    if ('rejudge' in action) return this.rejudge(id(action.rejudge));
    if ('block' in action)
      return this.changeJudge(action.block, { isBlocked: true });
    if ('rotate_key' in action)
      return this.changeJudge(action.rotate_key, {
        authKeyHash: sha256('rotated'),
      });
    await this.bridge.judges.updateOne(
      { name: action.disable },
      { isDisabled: true },
    );
    await this.commands.publish({
      type: 'disable-judge',
      judgeName: action.disable,
      isDisabled: true,
    });
  }

  /** The scenarios rejudge held (P/G) rows too, so the reset is unconditional (the api's `resetForJudging` skips P/G). */
  private async rejudge(submissionId: string): Promise<void> {
    await this.bridge.submissions.updateOne(
      { _id: submissionId },
      requeueUpdate(SUBMISSION_PRIORITY.rejudge),
    );
    await this.commands.judge([submissionId]);
  }

  private async changeJudge(name: string, change: object): Promise<void> {
    await this.bridge.judges.updateOne({ name }, change);
    await this.commands.publish({
      type: 'disconnect-judge',
      judgeName: name,
      force: true,
    });
  }

  /** The first difference between `end_state` and Mongo now, or null. */
  async endStateMismatch({ end_state }: Scenario): Promise<string | null> {
    if (!end_state) return null;
    const actual: Record<string, Json> = {};
    const submissions = (end_state.submissions ?? {}) as Record<string, Json>;
    if (Object.keys(submissions).length)
      actual.submissions = await this.submissionsState(
        Object.keys(submissions),
      );
    const judges = (end_state.judges ?? {}) as Record<string, Json>;
    if (Object.keys(judges).length)
      actual.judges = await this.judgesState(Object.keys(judges));
    if ('gradedJobs' in end_state)
      actual.gradedJobs = (await this.bridge.gradedJobs()).length;
    return mismatch(end_state, actual);
  }

  /** Each placeholder's row with `caseCount` in place of `cases`. */
  private async submissionsState(
    names: string[],
  ): Promise<Record<string, Json>> {
    const state: Record<string, Json> = {};
    for (const name of names) {
      const row = await this.bridge.submissions
        .findById(this.bindings.get(name))
        .select('+cases')
        .lean();
      if (!row) continue;
      const { cases, ...fields } = row;
      state[name] = asJson({ ...fields, caseCount: cases.length });
    }
    return state;
  }

  private async judgesState(names: string[]): Promise<Record<string, Json>> {
    const rows = await this.bridge.judges.find({ name: { $in: names } }).lean();
    return Object.fromEntries(rows.map((row) => [row.name, asJson(row)]));
  }
}
