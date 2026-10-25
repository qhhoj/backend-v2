import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { createReadStream } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { AppError, StorageService, writeFileAtomically } from '@libs/common';
import {
  dataFileNamesOf,
  emptyProblemData,
  newId,
  STATEMENT_LANGUAGES,
} from '@libs/database';
import type {
  JsonObject,
  ProblemData,
  SyncedSettingFingerprints,
} from '@libs/database';
import { notifyRescore, PROBLEM_RESCORE_QUEUE } from '@libs/judging';
import type { ProblemRescoreJob } from '@libs/judging';
import {
  compileInitYaml,
  extensionOf,
  PDF_QUEUE,
  PdfCacheService,
  importOptionsOf,
  pdfJobId,
  POLYGON_PACKAGE_MAX_BYTES,
  PolygonApiError,
  PolygonClient,
  ProblemDataError,
  ProblemDataFilesService,
  SOURCE_MAX_BYTES,
  variantOf,
} from '@libs/problems';
import type {
  ImportErrorParams,
  ImportOptions,
  LocalEdits,
  PdfRenderJob,
  PolygonImportJob,
  PolygonImportResult,
  PolygonSource,
} from '@libs/problems';
import type { Readable } from 'node:stream';
import { importSummaryOf } from './import-summary';
import {
  editedSince,
  fingerprintsOf,
  mergeLocalEdits,
  settingsNamedIn,
  sourceHashOf,
} from './local-edits';
import type {
  LocalSettings,
  SettingsState,
  SourceHashes,
  SyncedValues,
} from './local-edits';
import { ImportTracker } from './import-tracker';
import { PandocService } from './pandoc.service';
import { parseAssets } from './polygon-assets';
import type { PolygonAssets } from './polygon-assets';
import { helperHeadersOf } from './polygon-headers';
import type { HelperHeader } from './polygon-headers';
import { ImportQuota } from './import-quota.service';
import { ImportSourceChecks } from './import-source-checks';
import { PolygonImportError, SyncDeferredError } from './polygon-import.error';
import { PolygonImportRepository } from './polygon-import.repository';
import type {
  AppliedImport,
  ImportedProblem,
  ImportTarget,
  TargetSettings,
} from './polygon-import.repository';
import {
  CHECKER_FILE,
  INTERACTOR_FILE,
  PolygonPackage,
  repackTests,
  TESTS_ARCHIVE,
} from './polygon-package';
import {
  mainSolution,
  parseStatements,
  renderStatement,
  withMainSolution,
} from './polygon-statements';
import { planTests } from './polygon-tests';
import type { PlannedTest, TestPlan } from './polygon-tests';
import { RunningContestsRepository } from './running-contests.repository';
import {
  generatedTestsPathOf,
  StandardPackageTests,
} from './standard-package-tests';
import type { XmlElement } from '@libs/problems';

/** A data file written beside the final one and renamed into place only after the transaction matched. */
interface StagedFile {
  name: string;
  stagedPath: string;
}

/** The checker, interactor and header sources a package ships, read once. */
interface PackageSources {
  customChecker: Buffer | null;
  customGrader: Buffer | null;
  /** Each header's content by its name in the data directory. */
  helperHeaders: Map<string, Buffer>;
}

interface ReadPackage {
  /** problem.xml, for the plan of a standard package's generation. */
  root: XmlElement;
  plan: TestPlan;
  tests: PlannedTest[];
  assets: PolygonAssets;
  sources: PackageSources;
  yaml: string | null;
  imported: ImportedProblem;
}

/** The queued job's id and when it was queued. */
export interface ImportRun {
  id: string;
  queuedAt: Date;
}

/** What the job found before it opened the package. */
interface ImportContext {
  target: ImportTarget;
  /** Syncs only: the settings the setter may have edited since the last import. */
  local: LocalSettings | null;
  tracker: ImportTracker;
  /** When the job was queued: bounds how long an automatic sync waits for a contest. */
  queuedAt: Date;
}

/** What `commitWithData` needs beside the job: the read package, its staged files, and where the import goes. */
interface CommitInput {
  read: ReadPackage;
  staged: StagedFile[];
  target: ImportTarget;
  tracker: ImportTracker;
  queuedAt: Date;
}

/** The committed import and, when a data step failed after the commit, why it needs attention. */
interface WrittenImport {
  applied: AppliedImport;
  attention: PolygonImportResult['attention'];
}

/** How long an automatic sync may wait for running contests (from when it was queued) before it fails with `problem_in_running_contest`. */
export const MAX_SYNC_DEFERRAL_MS = 7 * 86_400_000;

/** How long an import waits for an API data write that holds the problem's data lock; a test may shorten it. */
export const IMPORT_DATA_LOCK = { waitSeconds: 60 };

/** `withDataWrite` refused the lock: another data change held it for the whole wait. */
const isLockBusy = (error: unknown): boolean =>
  error instanceof AppError &&
  error.status === 409 &&
  (error.extra?.issues as Array<{ code: string }> | undefined)?.some(
    (issue) => issue.code === 'busy',
  ) === true;

const dataLockBusyError = () =>
  new PolygonImportError(
    "another change to this problem's data is in progress, try again",
    'problem_changed',
  );

/** `params.step` names the step that failed, as the message does. */
const needsAttention = (
  message: string,
  params: ImportErrorParams,
): PolygonImportResult['attention'] => ({
  code: 'imported_needs_attention',
  params,
  message,
});

const isStandard = (job: PolygonImportJob): boolean =>
  job.polygon?.packageType === 'standard';

/** Headers go beside the package's checker and interactor, whose init.yml `files` list them (a judge with `interactive.checker` reads a checker's list); a problem with neither, an hcmp one, gets none. A sync never takes a header named like one of the problem's other data files: a kept local checker keeps its bytes. */
const helperHeaders = (
  { root, pkg }: { root: XmlElement; pkg: PolygonPackage },
  assets: PolygonAssets,
  local: LocalSettings | null,
): HelperHeader[] =>
  assets.checkerSource || assets.interactorSource
    ? helperHeadersOf(root, pkg, nonHeaderFilesOf(local))
    : [];

/** The local data files a package header must not replace: every file the problem names except its headers. */
const nonHeaderFilesOf = (local: LocalSettings | null): Set<string> =>
  new Set(
    local ? dataFileNamesOf({ ...local.state.data, helperHeaders: [] }) : [],
  );

/** Grader arguments from the tests (file io) and from the assets (interactor points); null when neither has any. */
const joinArgs = (
  first: JsonObject | null,
  second: JsonObject | null,
): JsonObject | null => (first || second ? { ...first, ...second } : null);

const dataOf = (
  assets: PolygonAssets,
  plan: TestPlan,
  sources: PackageSources,
): ProblemData => ({
  ...emptyProblemData(),
  archive: TESTS_ARCHIVE,
  checker: assets.checker,
  checkerArgs: assets.checkerArgs,
  customChecker: assets.checkerSource ? CHECKER_FILE : null,
  grader: assets.grader,
  customGrader: assets.interactorSource ? INTERACTOR_FILE : null,
  helperHeaders: [...sources.helperHeaders.keys()],
  interactiveChecker: Boolean(assets.interactorSource),
  graderArgs: joinArgs(plan.graderArgs, assets.graderArgs),
  cases: plan.cases,
});

/** The checker, interactor and header sources the package ships. */
async function readSources(
  pkg: PolygonPackage,
  assets: PolygonAssets,
  headers: HelperHeader[],
): Promise<PackageSources> {
  const read = (path: string | null) =>
    path ? pkg.read(path, SOURCE_MAX_BYTES) : Promise.resolve(null);
  const helperHeaders = new Map<string, Buffer>();
  for (const { path, name } of headers)
    helperHeaders.set(name, await pkg.read(path, SOURCE_MAX_BYTES));
  return {
    customChecker: await read(assets.checkerSource),
    customGrader: await read(assets.interactorSource),
    helperHeaders,
  };
}

const packageSourceHashes = (sources: PackageSources): SourceHashes => ({
  customChecker: sourceHashOf(sources.customChecker),
  customGrader: sourceHashOf(sources.customGrader),
  helperHeaders: Object.fromEntries(
    [...sources.helperHeaders].map(([name, content]) => [
      name,
      sourceHashOf(content),
    ]),
  ),
});

/** The package's settings with a sync's local edits kept (see `mergeLocalEdits`); the link records the package's own. */
function settingsOf(
  job: PolygonImportJob,
  { assets, plan, sources }: Pick<ReadPackage, 'assets' | 'plan' | 'sources'>,
  local: LocalSettings | null,
): {
  values: SyncedValues;
  localEdits: LocalEdits | null;
  recorded: SyncedSettingFingerprints;
} {
  const values: SyncedValues = {
    timeLimit: plan.timeLimit,
    memoryLimit: plan.memoryLimit,
    partial: plan.partial,
    data: dataOf(assets, plan, sources),
  };
  const incoming: SettingsState = {
    ...values,
    sourceHashes: packageSourceHashes(sources),
  };
  return local
    ? mergeLocalEdits(incoming, local, job.overwriteLocalEdits === true)
    : { values, localEdits: null, recorded: fingerprintsOf(incoming) };
}

/** The job's result: the problem, the conversion summary, what a sync kept, and whether it needs a repair. */

function resultOf(
  job: PolygonImportJob,
  applied: AppliedImport,
  read: ReadPackage,
  attention: PolygonImportResult['attention'],
): PolygonImportResult {
  const { localEdits } = read.imported;
  return {
    problemId: applied.problemId,
    code: job.code,
    summary: importSummaryOf(read.assets, read.plan, read.imported),
    ...(localEdits && { localEdits }),
    ...(attention && { attention }),
  };
}

/** A full package carries every test and answer; a standard one has them generated. */
function assertTestsShipped(
  pkg: PolygonPackage,
  plan: TestPlan,
  job: PolygonImportJob,
): void {
  if (
    !isStandard(job) &&
    !plan.tests.every(
      (test) => pkg.has(test.inputPath) && pkg.has(test.answerPath),
    )
  )
    throw new PolygonImportError('not full package', 'package_incomplete');
}

/** An update that does not import the tutorial leaves the problem's editorial as it is. */
const keepsEditorial = (
  job: PolygonImportJob,
  options: ImportOptions,
): boolean => !options.importTutorial && job.mode === 'update';

@Injectable()
export class PolygonImportService {
  private readonly logger = new Logger(PolygonImportService.name);

  constructor(
    private readonly pandoc: PandocService,
    private readonly storage: StorageService,
    private readonly dataFiles: ProblemDataFilesService,
    private readonly pdfCache: PdfCacheService,
    private readonly repository: PolygonImportRepository,
    private readonly polygon: PolygonClient,
    private readonly standardTests: StandardPackageTests,
    private readonly quota: ImportQuota,
    private readonly sourceChecks: ImportSourceChecks,
    private readonly runningContests: RunningContestsRepository,
    @InjectQueue(PDF_QUEUE) private readonly pdfQueue: Queue<PdfRenderJob>,
    @InjectQueue(PROBLEM_RESCORE_QUEUE)
    private readonly rescoreQueue: Queue<ProblemRescoreJob>,
  ) {}

  /** A sync another sync of the same package already applied ends at once; then pre-checks that cost nothing come first; the package (uploaded, or downloaded here from Polygon) is removed however the job ends. */
  async import(
    run: ImportRun,
    job: PolygonImportJob,
    tracker = new ImportTracker(),
  ): Promise<PolygonImportResult> {
    const synced = await this.repository.syncedMeanwhile(job, run.queuedAt);
    if (synced) return { problemId: synced, code: job.code };
    const packagePath = this.dataFiles.importPackagePathOf(run.id);
    try {
      await this.pandoc.assertAvailable();
      const target = await this.repository.resolveTarget(job);
      await this.assertNoRunningContest(job, run.queuedAt);
      await this.repository.assertFullMarkupWriter(job);
      if (job.polygon) {
        await this.download(run.id, job.polygon, tracker);
        await this.quota.assertPackageFits(job, target, packagePath);
      }
      const local = await this.localSettingsOf(job.code, target?.settings);
      return await this.importPackage(packagePath, job, {
        target,
        local,
        tracker,
        queuedAt: run.queuedAt,
      });
    } finally {
      await rm(packagePath, { force: true });
      await rm(generatedTestsPathOf(packagePath), { force: true });
    }
  }

  /** An automatic sync never changes a problem under a running contest; checked before the download and again under the data lock, right before the write. It waits for the contest's end, `MAX_SYNC_DEFERRAL_MS` after it was queued at most, then fails. A sync someone started keeps its own rule. */
  private async assertNoRunningContest(
    job: PolygonImportJob,
    queuedAt: Date,
  ): Promise<void> {
    if (job.polygon?.trigger !== 'auto') return;
    const now = new Date();
    const until = await this.runningContests.runningUntil(job.code, now);
    if (!until) return;
    const deadline = new Date(queuedAt.getTime() + MAX_SYNC_DEFERRAL_MS);
    if (now >= deadline)
      throw new PolygonImportError(
        'a contest using the problem was still running a week after the automatic sync was queued; sync it by hand',
        'problem_in_running_contest',
        { until: until.toISOString() },
      );
    throw new SyncDeferredError(until < deadline ? until : deadline);
  }

  /** A Polygon failure (refused credentials, package not built for Linux, too large) is shown to the requester. */
  private async download(
    jobId: string,
    source: PolygonSource,
    tracker: ImportTracker,
  ): Promise<void> {
    const destination = await this.dataFiles.importPackagePath(jobId);
    await tracker.progress({ step: 'downloading', done: 0, total: null });
    try {
      await this.polygon.downloadPackage(source, destination, {
        maxBytes: POLYGON_PACKAGE_MAX_BYTES,
        type: variantOf(source.packageType ?? 'full'),
        onProgress: (done, total) =>
          void tracker.progress({ step: 'downloading', done, total }),
      });
    } catch (error) {
      if (error instanceof PolygonApiError)
        throw new PolygonImportError(`Polygon: ${error.message}`, error.code);
      throw error;
    }
  }

  /**
   * Parse, render and compile everything that can fail without touching the database; then stage the data files, and under the data lock run the transaction and only after it committed give the files their final names and write init.yml.
   * Before the commit a failure removes the images and staged files it saved; after it, Mongo is authoritative and nothing it references is removed.
   */
  private async importPackage(
    packagePath: string,
    job: PolygonImportJob,
    { target, local, tracker, queuedAt }: ImportContext,
  ): Promise<PolygonImportResult> {
    const pkg = await PolygonPackage.open(packagePath);
    const savedImages: string[] = [];
    const staged: StagedFile[] = [];
    let committed = false;
    try {
      await tracker.progress({ step: 'statements', done: null, total: null });
      const read = await this.readPackage(pkg, job, { savedImages, local });
      const generated = isStandard(job)
        ? await this.generateStandardTests(
            packagePath,
            { pkg, read },
            { job, target, tracker },
          )
        : null;
      await tracker.progress({ step: 'tests', done: null, total: null });
      const testsArchive = generated
        ? createReadStream(generated)
        : repackTests(pkg, read.tests);
      staged.push(...(await this.stageFiles(job.code, testsArchive, read)));
      tracker.enter('saving');
      const written = await this.commitWithData(
        job,
        { read, staged, target, tracker, queuedAt },
        () => (committed = true),
      );
      const attention = await this.afterDataWrite(job, written, read);
      return resultOf(job, written.applied, read, attention);
    } catch (error) {
      if (!committed) await this.undo(job, savedImages, staged);
      throw error;
    } finally {
      await pkg.close();
    }
  }

  /** Everything that can fail before a file is staged: problem.xml, the test plan, statements (images are saved as found), the settings a sync keeps, and init.yml. */
  private async readPackage(
    pkg: PolygonPackage,
    job: PolygonImportJob,
    {
      savedImages,
      local,
    }: { savedImages: string[]; local: LocalSettings | null },
  ): Promise<ReadPackage> {
    const root = await pkg.problemXml();
    const assets = parseAssets(root);
    const options = importOptionsOf(job);
    const plan = planTests(root, options);
    assertTestsShipped(pkg, plan, job);
    const { tutorial, ...statement } = await this.readStatements(
      root,
      pkg,
      { job, options },
      savedImages,
    );
    const headers = helperHeaders({ root, pkg }, assets, local);
    const sources = await readSources(pkg, assets, headers);
    const settings = settingsOf(job, { assets, plan, sources }, local);
    const compiled = this.compile(settings.values.data, plan.tests);
    return {
      root,
      plan,
      tests: plan.tests,
      assets,
      sources,
      yaml: compiled.yaml,
      imported: {
        ...statement,
        ...settings.values,
        ...this.editorialOf(tutorial, keepsEditorial(job, options)),
        data: { ...settings.values.data, cases: compiled.cases },
        settings: settings.recorded,
        localEdits: settings.localEdits,
      },
    };
  }

  /** A sync's view of the problem: its settings with the checker, interactor and headers read from disk, and which of them the setter edited since the last import (by the link's record, else by the revisions). Null for other imports. */
  private async localSettingsOf(
    code: string,
    settings: TargetSettings | null | undefined,
  ): Promise<LocalSettings | null> {
    if (!settings) return null;
    const { values, imported, revisedFields } = settings;
    const state: SettingsState = {
      ...values,
      sourceHashes: await this.storedSourceHashes(code, values.data),
    };
    return {
      state,
      edited: imported
        ? editedSince(imported, state)
        : settingsNamedIn(revisedFields),
    };
  }

  private async storedSourceHashes(
    code: string,
    data: ProblemData,
  ): Promise<SourceHashes> {
    const helperHeaders: SourceHashes['helperHeaders'] = {};
    for (const name of data.helperHeaders ?? [])
      helperHeaders[name] = await this.storedSourceHash(code, name);
    return {
      customChecker: await this.storedSourceHash(code, data.customChecker),
      customGrader: await this.storedSourceHash(code, data.customGrader),
      helperHeaders,
    };
  }

  /** A missing file reads as none: the setter's configuration names a file the problem lost. */
  private async storedSourceHash(
    code: string,
    name: string | null,
  ): Promise<string | null> {
    if (!name) return null;
    const content = await readFile(this.dataFiles.pathOf(code, name)).catch(
      () => null,
    );
    return sourceHashOf(content);
  }

  /** A standard package has no generated tests: a judge makes them, and the result zip becomes `tests.zip`. */
  private async generateStandardTests(
    packagePath: string,
    { pkg, read }: { pkg: PolygonPackage; read: ReadPackage },
    {
      job,
      target,
      tracker,
    }: { job: PolygonImportJob; target: ImportTarget; tracker: ImportTracker },
  ): Promise<string> {
    await tracker.progress({ step: 'generating', done: null, total: null });
    const destination = generatedTestsPathOf(packagePath);
    await this.standardTests.generate(pkg, read, destination);
    await this.quota.assertGeneratedTestsFit(job, target, destination);
    return destination;
  }

  private async readStatements(
    root: XmlElement,
    pkg: PolygonPackage,
    { job, options }: { job: PolygonImportJob; options: ImportOptions },
    savedImages: string[],
  ) {
    const statements = await parseStatements(root, {
      pkg,
      job,
      texToMarkdown: (tex) => this.pandoc.texToMarkdown(tex),
      saveImage: this.imageSaver(savedImages),
    });
    if (options.appendMainSolution && !keepsEditorial(job, options)) {
      const solution = await mainSolution(root, pkg);
      statements.tutorial = withMainSolution(
        statements.tutorial,
        solution.code,
        solution.sourceType,
      );
    }
    return statements;
  }

  /**
   * The data lock is taken before the transaction and held until the stamp, so no API data write lands between the commit and the files: one that holds the lock is waited for (`IMPORT_DATA_LOCK`), and one still holding it fails the import before anything changed.
   * The data steps run under the judge's writing marker, ending with the stamp; a failure after the commit comes back as `attention`.
   */
  private async commitWithData(
    job: PolygonImportJob,
    { read, staged, target, tracker, queuedAt }: CommitInput,
    onCommitted: () => void,
  ): Promise<WrittenImport> {
    const write = async (): Promise<WrittenImport> => {
      await this.assertNoRunningContest(job, queuedAt);
      const applied = await this.repository.apply(job, read.imported, target);
      onCommitted();
      tracker.enter('finishing');
      const attention = await this.attentionOnFailure(job.code, async () => {
        await this.runSteps(
          job.code,
          this.dataSteps(job.code, applied, staged, read),
        );
        await this.recordDataBytes(applied.problemId, job.code);
      });
      return { applied, attention };
    };
    try {
      return await this.dataFiles.withDataWrite(job.code, write, {
        waitSeconds: IMPORT_DATA_LOCK.waitSeconds,
      });
    } catch (error) {
      throw isLockBusy(error) ? dataLockBusyError() : error;
    }
  }

  /** Rescore, then (when the data files are in place) the cached PDFs are dropped and the checker and interactor are compiled on a judge. */
  private async afterDataWrite(
    job: PolygonImportJob,
    { applied, attention }: WrittenImport,
    read: Pick<ReadPackage, 'imported'>,
  ): Promise<PolygonImportResult['attention']> {
    // Points, partial and the cases may all have changed; a create has no submissions yet. Never throws: the import stands.
    if (job.mode === 'update')
      await notifyRescore(this.rescoreQueue, applied.problemId, this.logger);
    if (attention) return attention;
    return this.attentionOnFailure(job.code, async () => {
      await this.runSteps(job.code, [
        ['dropping the cached PDFs', () => this.dropPdfs(job.code)],
      ]);
      await this.sourceChecks.checkAfterImport(
        applied.problemId,
        read.imported,
      );
    });
  }

  /** A failure after the commit leaves the problem imported, so it is logged with its cause and comes back as `attention` (the job completes: an import that needs a repair, never "Import failed"). */
  private async attentionOnFailure(
    code: string,
    work: () => Promise<void>,
  ): Promise<PolygonImportResult['attention']> {
    try {
      await work();
      return undefined;
    } catch (error) {
      // `runSteps` logged its own failures with their cause.
      if (error instanceof PolygonImportError)
        return needsAttention(error.message, error.params);
      this.logger.error(
        `Polygon import of ${code}: committed, but the data write failed`,
        error instanceof Error ? error.stack : String(error),
      );
      return needsAttention(
        'the problem was imported, but writing its data files failed',
        { step: 'writing its data files' },
      );
    }
  }

  /** Measured under the data lock, after the files are in place. The import stands when measuring fails: the backfill and the next data write fix the number. */
  private async recordDataBytes(
    problemId: string,
    code: string,
  ): Promise<void> {
    try {
      await this.repository.setDataBytes(
        problemId,
        await this.dataFiles.bytesOf(code),
      );
    } catch (error) {
      this.logger.warn(
        `Polygon import of ${code}: dataBytes not recorded: ${(error as Error).message}`,
      );
    }
  }

  /** Files the written configuration no longer names are removed; a kept local checker or interactor is named, so it stays. */
  private dataSteps(
    code: string,
    applied: AppliedImport,
    staged: StagedFile[],
    { yaml, imported }: Pick<ReadPackage, 'yaml' | 'imported'>,
  ): Array<[string, () => Promise<unknown>]> {
    const kept = new Set(dataFileNamesOf(imported.data));
    return [
      [
        'moving the data files into place',
        async () => {
          for (const { name, stagedPath } of staged)
            await this.dataFiles.commitUpload(code, stagedPath, name);
        },
      ],
      [
        'removing the unused data files',
        async () => {
          for (const name of applied.previousFiles)
            if (!kept.has(name)) await this.dataFiles.removeFile(code, name);
        },
      ],
      [
        'writing init.yml',
        () =>
          yaml === null
            ? this.dataFiles.removeInit(code)
            : this.dataFiles.writeInit(code, yaml),
      ],
      [
        'stamping the data version',
        () => this.dataFiles.writeDataVersion(code, applied.dataVersion),
      ],
    ];
  }

  private async runSteps(
    code: string,
    steps: Array<[string, () => Promise<unknown>]>,
  ): Promise<void> {
    for (const [step, work] of steps)
      try {
        await work();
      } catch (error) {
        this.logger.error(
          `Polygon import of ${code}: committed, but ${step} failed`,
          error instanceof Error ? error.stack : String(error),
        );
        throw new PolygonImportError(
          `the problem was imported, but ${step} failed`,
          'imported_needs_attention',
          { step },
        );
      }
  }

  /** Images the statement references are saved as they are found, so a failed job must take them back. */
  private async undo(
    job: PolygonImportJob,
    savedImages: string[],
    staged: StagedFile[],
  ): Promise<void> {
    await Promise.all([
      ...savedImages.map((relativePath) => this.storage.delete(relativePath)),
      ...staged.map(({ stagedPath }) => rm(stagedPath, { force: true })),
    ]).catch(() => undefined);
    await this.dataFiles
      .removeDirectoryIfEmpty(job.code)
      .catch(() => undefined);
  }

  /** `rehostImages` has already sniffed the bytes and sanitised SVG; the extension follows the sniffed type. */
  private imageSaver(savedImages: string[]) {
    return async (bytes: Buffer, name: string): Promise<string> => {
      const relativePath = `images/${newId()}.${extensionOf(name)}`;
      const url = await this.storage.save(relativePath, bytes);
      savedImages.push(relativePath);
      return url;
    };
  }

  private compile(data: ProblemData, tests: PlannedTest[]) {
    try {
      return compileInitYaml(
        data,
        new Set(tests.flatMap((test) => [test.inputName, test.outputName])),
      );
    } catch (error) {
      if (error instanceof ProblemDataError)
        throw new PolygonImportError(`init.yml: ${error.message}`);
      throw error;
    }
  }

  /** `solution` of the imported problem. An update that does not import the tutorial leaves the editorial alone, whatever else is ticked; any other import writes what the statements and the appended solution made (nothing, for a new problem without either). */
  private editorialOf(
    tutorial: string,
    keepsCurrent: boolean,
  ): Pick<ImportedProblem, 'solution'> {
    if (keepsCurrent) return {};
    return { solution: this.renderTutorial(tutorial) };
  }

  /** The appended solution source is text `parseStatements` never saw, so the finished editorial gets the editor's limits and the sanitising `solution` style here. */
  private renderTutorial(markdown: string): ImportedProblem['solution'] {
    const content = markdown.trim();
    return content
      ? {
          content,
          contentHtml: renderStatement(content, 'solution', 'tutorial'),
        }
      : null;
  }

  /** The package's checker and interactor are staged only where the problem takes them: a sync that keeps the local one leaves its file alone, whatever its name. Every package header is staged; the headers only a kept source names stay as they are. */
  private async stageFiles(
    code: string,
    testsArchive: Readable,
    { sources, imported }: Pick<ReadPackage, 'sources' | 'imported'>,
  ): Promise<StagedFile[]> {
    const kept = imported.localEdits?.kept ?? [];
    const staged: StagedFile[] = [];
    const stage = async (name: string, content: Buffer | Readable | null) => {
      if (content === null) return;
      const stagedPath = await this.dataFiles.stageUpload(code);
      staged.push({ name, stagedPath });
      await writeFileAtomically(stagedPath, content);
    };
    try {
      await stage(TESTS_ARCHIVE, testsArchive);
      if (!kept.includes('checker'))
        await stage(CHECKER_FILE, sources.customChecker);
      if (!kept.includes('grader'))
        await stage(INTERACTOR_FILE, sources.customGrader);
      for (const [name, content] of sources.helperHeaders)
        await stage(name, content);
    } catch (error) {
      await Promise.all(
        staged.map(({ stagedPath }) => rm(stagedPath, { force: true })),
      );
      throw error;
    }
    return staged;
  }

  /** The editor drops cached PDFs and queued render jobs (a failed one would keep answering 503) on a statement change; the worker does the same directly. */
  private async dropPdfs(code: string): Promise<void> {
    await this.pdfCache.delete(code);
    await Promise.all(
      STATEMENT_LANGUAGES.map((lang) =>
        this.pdfQueue.remove(pdfJobId(code, lang)),
      ),
    );
  }
}
