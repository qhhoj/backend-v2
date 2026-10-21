import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { createReadStream } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { StorageService, writeFileAtomically } from '@libs/common';
import {
  dataFileNamesOf,
  emptyProblemData,
  newId,
  STATEMENT_LANGUAGES,
} from '@libs/database';
import type { ProblemData, SyncedSettingFingerprints } from '@libs/database';
import { notifyRescore, PROBLEM_RESCORE_QUEUE } from '@libs/judging';
import type { ProblemRescoreJob } from '@libs/judging';
import {
  compileInitYaml,
  extensionOf,
  PDF_QUEUE,
  PdfCacheService,
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
import type { LocalSettings, SettingsState, SyncedValues } from './local-edits';
import { ImportTracker } from './import-tracker';
import { PandocService } from './pandoc.service';
import { parseAssets } from './polygon-assets';
import type { PolygonAssets } from './polygon-assets';
import { helperHeadersOf } from './polygon-headers';
import type { HelperHeader } from './polygon-headers';
import { ImportQuota } from './import-quota.service';
import { ImportSourceChecks } from './import-source-checks';
import { PolygonImportError } from './polygon-import.error';
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

/** The checker and interactor sources a package ships, read once. */
interface PackageSources {
  customChecker: Buffer | null;
  customGrader: Buffer | null;
}

interface ReadPackage {
  /** problem.xml, for the plan of a standard package's generation. */
  root: XmlElement;
  plan: TestPlan;
  tests: PlannedTest[];
  assets: PolygonAssets;
  headers: HelperHeader[];
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
}

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

/** Headers go beside the package's checker and interactor, whose init.yml `files` list them (a judge with `interactive.checker` reads a checker's list); a problem with neither, an hcmp one, gets none. */
const helperHeaders = (
  root: XmlElement,
  pkg: PolygonPackage,
  assets: PolygonAssets,
): HelperHeader[] =>
  assets.checkerSource || assets.interactorSource
    ? helperHeadersOf(root, pkg)
    : [];

const dataOf = (
  assets: PolygonAssets,
  plan: TestPlan,
  headers: HelperHeader[],
): ProblemData => ({
  ...emptyProblemData(),
  archive: TESTS_ARCHIVE,
  checker: assets.checker,
  checkerArgs: assets.checkerArgs,
  customChecker: assets.checkerSource ? CHECKER_FILE : null,
  grader: assets.grader,
  customGrader: assets.interactorSource ? INTERACTOR_FILE : null,
  helperHeaders: headers.map(({ name }) => name),
  interactiveChecker: Boolean(assets.interactorSource),
  graderArgs: plan.graderArgs,
  cases: plan.cases,
});

/** The checker and interactor sources the package ships. */
async function readSources(
  pkg: PolygonPackage,
  assets: PolygonAssets,
): Promise<PackageSources> {
  const read = (path: string | null) =>
    path ? pkg.read(path, SOURCE_MAX_BYTES) : Promise.resolve(null);
  return {
    customChecker: await read(assets.checkerSource),
    customGrader: await read(assets.interactorSource),
  };
}

/** The package's settings with a sync's local edits kept (see `mergeLocalEdits`); the link records the package's own. */
function settingsOf(
  job: PolygonImportJob,
  {
    assets,
    plan,
    headers,
    sources,
  }: Omit<ReadPackage, 'root' | 'tests' | 'yaml' | 'imported'>,
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
    data: dataOf(assets, plan, headers),
  };
  const incoming: SettingsState = {
    ...values,
    sourceHashes: {
      customChecker: sourceHashOf(sources.customChecker),
      customGrader: sourceHashOf(sources.customGrader),
    },
  };
  const merged = local
    ? mergeLocalEdits(incoming, local, job.overwriteLocalEdits === true)
    : { values, localEdits: null };
  return { ...merged, recorded: fingerprintsOf(incoming) };
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
      });
    } finally {
      await rm(packagePath, { force: true });
      await rm(generatedTestsPathOf(packagePath), { force: true });
    }
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
   * Parse, render and compile everything that can fail without touching the database; then stage the data files, run the transaction, and only after it committed give the files their final names and write init.yml.
   * Before the commit a failure removes the images and staged files it saved; after it, Mongo is authoritative and nothing it references is removed.
   */
  private async importPackage(
    packagePath: string,
    job: PolygonImportJob,
    { target, local, tracker }: ImportContext,
  ): Promise<PolygonImportResult> {
    const pkg = await PolygonPackage.open(packagePath);
    const savedImages: string[] = [];
    const staged: StagedFile[] = [];
    let committed = false;
    try {
      await tracker.progress({ step: 'statements', done: null, total: null });
      const read = await this.readPackage(pkg, job, { savedImages, local });
      const generated = isStandard(job)
        ? await this.generateStandardTests(packagePath, pkg, read, tracker)
        : null;
      await tracker.progress({ step: 'tests', done: null, total: null });
      const testsArchive = generated
        ? createReadStream(generated)
        : repackTests(pkg, read.tests);
      staged.push(
        ...(await this.stageFiles(job.code, pkg, testsArchive, read)),
      );
      tracker.enter('saving');
      const applied = await this.repository.apply(job, read.imported, target);
      committed = true;
      tracker.enter('finishing');
      const attention = await this.afterCommit(job, applied, staged, read);
      return resultOf(job, applied, read, attention);
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
    const plan = planTests(root, job);
    assertTestsShipped(pkg, plan, job);
    const { tutorial, ...statement } = await this.readStatements(
      root,
      pkg,
      job,
      savedImages,
    );
    const headers = helperHeaders(root, pkg, assets);
    const sources = await readSources(pkg, assets);
    const settings = settingsOf(job, { assets, plan, headers, sources }, local);
    const compiled = this.compile(settings.values.data, plan.tests);
    return {
      root,
      plan,
      tests: plan.tests,
      assets,
      headers,
      sources,
      yaml: compiled.yaml,
      imported: {
        ...statement,
        ...settings.values,
        solution: this.renderTutorial(tutorial),
        data: { ...settings.values.data, cases: compiled.cases },
        settings: settings.recorded,
        localEdits: settings.localEdits,
      },
    };
  }

  /** A sync's view of the problem: its settings with the checker and interactor read from disk, and which of them the setter edited since the last import (by the link's record, else by the revisions). Null for other imports. */
  private async localSettingsOf(
    code: string,
    settings: TargetSettings | null | undefined,
  ): Promise<LocalSettings | null> {
    if (!settings) return null;
    const { values, imported, revisedFields } = settings;
    const state: SettingsState = {
      ...values,
      sourceHashes: {
        customChecker: await this.storedSourceHash(
          code,
          values.data.customChecker,
        ),
        customGrader: await this.storedSourceHash(
          code,
          values.data.customGrader,
        ),
      },
    };
    return {
      state,
      edited: imported
        ? editedSince(imported, state)
        : settingsNamedIn(revisedFields),
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
    pkg: PolygonPackage,
    read: ReadPackage,
    tracker: ImportTracker,
  ): Promise<string> {
    await tracker.progress({ step: 'generating', done: null, total: null });
    const destination = generatedTestsPathOf(packagePath);
    await this.standardTests.generate(pkg, read, destination);
    return destination;
  }

  private async readStatements(
    root: XmlElement,
    pkg: PolygonPackage,
    job: PolygonImportJob,
    savedImages: string[],
  ) {
    const statements = await parseStatements(root, {
      pkg,
      job,
      texToMarkdown: (tex) => this.pandoc.texToMarkdown(tex),
      saveImage: this.imageSaver(savedImages),
    });
    if (job.appendMainSolution) {
      const solution = await mainSolution(root, pkg);
      statements.tutorial = withMainSolution(
        statements.tutorial,
        solution.code,
        solution.sourceType,
      );
    }
    return statements;
  }

  /** Rescore, then the file steps; a failure here leaves the problem imported, so it is logged with its cause and comes back as `attention` (the job completes: an import that needs a repair, never "Import failed"). */
  private async afterCommit(
    job: PolygonImportJob,
    applied: AppliedImport,
    staged: StagedFile[],
    read: ReadPackage,
  ): Promise<PolygonImportResult['attention']> {
    // Points, partial and the cases may all have changed; a create has no submissions yet. Never throws: the import stands.
    if (job.mode === 'update')
      await notifyRescore(this.rescoreQueue, applied.problemId, this.logger);
    try {
      await this.finish(job.code, applied, staged, read);
      return undefined;
    } catch (error) {
      // `runSteps` logged its own failures with their cause.
      if (error instanceof PolygonImportError)
        return needsAttention(error.message, error.params);
      this.logger.error(
        `Polygon import of ${job.code}: committed, but the data write failed`,
        error instanceof Error ? error.stack : String(error),
      );
      return needsAttention(
        'the problem was imported, but writing its data files failed',
        { step: 'writing its data files' },
      );
    }
  }

  /** The data steps run under the judge's writing marker, ending with the stamp; then the checker and interactor are compiled on a judge. */
  private async finish(
    code: string,
    applied: AppliedImport,
    staged: StagedFile[],
    read: Pick<ReadPackage, 'yaml' | 'imported'>,
  ): Promise<void> {
    await this.dataFiles.withDataWrite(code, async () => {
      await this.runSteps(code, this.dataSteps(code, applied, staged, read));
      await this.recordDataBytes(applied.problemId, code);
    });
    await this.runSteps(code, [
      ['dropping the cached PDFs', () => this.dropPdfs(code)],
    ]);
    await this.sourceChecks.checkAfterImport(applied.problemId, read.imported);
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

  /** The package's checker and interactor are staged only where the problem takes them: a sync that keeps the local one leaves its file alone, whatever its name. */
  private async stageFiles(
    code: string,
    pkg: PolygonPackage,
    testsArchive: Readable,
    {
      sources,
      headers,
      imported,
    }: Pick<ReadPackage, 'sources' | 'headers' | 'imported'>,
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
      for (const { path, name } of headers)
        await stage(name, await pkg.read(path, SOURCE_MAX_BYTES));
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
