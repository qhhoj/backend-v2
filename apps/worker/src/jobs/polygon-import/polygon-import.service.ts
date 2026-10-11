import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { rm } from 'node:fs/promises';
import { StorageService, writeFileAtomically } from '@libs/common';
import { emptyProblemData, newId, STATEMENT_LANGUAGES } from '@libs/database';
import type { ProblemData } from '@libs/database';
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
} from '@libs/problems';
import type {
  PdfRenderJob,
  PolygonImportJob,
  PolygonImportResult,
  PolygonSource,
} from '@libs/problems';
import type { Readable } from 'node:stream';
import { ImportTracker } from './import-tracker';
import { PandocService } from './pandoc.service';
import { parseAssets } from './polygon-assets';
import type { PolygonAssets } from './polygon-assets';
import { PolygonImportError } from './polygon-import.error';
import { PolygonImportRepository } from './polygon-import.repository';
import type {
  AppliedImport,
  ImportedProblem,
  ImportTarget,
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
import type { XmlElement } from './polygon-xml';

/** A data file written beside the final one and renamed into place only after the transaction matched. */
interface StagedFile {
  name: string;
  stagedPath: string;
}

interface ReadPackage {
  tests: PlannedTest[];
  assets: PolygonAssets;
  yaml: string | null;
  imported: ImportedProblem;
}

const dataOf = (assets: PolygonAssets, plan: TestPlan): ProblemData => ({
  ...emptyProblemData(),
  archive: TESTS_ARCHIVE,
  checker: assets.checker,
  checkerArgs: assets.checkerArgs,
  customChecker: assets.checkerSource ? CHECKER_FILE : null,
  grader: assets.grader,
  customGrader: assets.interactorSource ? INTERACTOR_FILE : null,
  graderArgs: plan.graderArgs,
  cases: plan.cases,
});

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
    @InjectQueue(PDF_QUEUE) private readonly pdfQueue: Queue<PdfRenderJob>,
    @InjectQueue(PROBLEM_RESCORE_QUEUE)
    private readonly rescoreQueue: Queue<ProblemRescoreJob>,
  ) {}

  /** Pre-checks that cost nothing come first; the package (uploaded, or downloaded here from Polygon) is removed however the job ends. */
  async import(
    jobId: string,
    job: PolygonImportJob,
    tracker = new ImportTracker(),
  ): Promise<PolygonImportResult> {
    const packagePath = this.dataFiles.importPackagePathOf(jobId);
    try {
      await this.pandoc.assertAvailable();
      const target = await this.repository.resolveTarget(job);
      await this.repository.assertFullMarkupWriter(job);
      if (job.polygon) await this.download(jobId, job.polygon, tracker);
      return await this.importPackage(packagePath, job, target, tracker);
    } finally {
      await rm(packagePath, { force: true });
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
        onProgress: (done, total) =>
          void tracker.progress({ step: 'downloading', done, total }),
      });
    } catch (error) {
      if (error instanceof PolygonApiError)
        throw new PolygonImportError(`Polygon: ${error.message}`);
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
    target: ImportTarget,
    tracker: ImportTracker,
  ): Promise<PolygonImportResult> {
    const pkg = await PolygonPackage.open(packagePath);
    const savedImages: string[] = [];
    const staged: StagedFile[] = [];
    let committed = false;
    try {
      await tracker.progress({ step: 'statements', done: null, total: null });
      const read = await this.readPackage(pkg, job, savedImages);
      await tracker.progress({ step: 'tests', done: null, total: null });
      staged.push(
        ...(await this.stageFiles(job.code, pkg, read.tests, read.assets)),
      );
      tracker.enter('saving');
      const applied = await this.repository.apply(job, read.imported, target);
      committed = true;
      tracker.enter('finishing');
      // Points, partial and the cases may all have changed; a create has no submissions yet. Never throws: the import stands.
      if (job.mode === 'update')
        await notifyRescore(this.rescoreQueue, applied.problemId, this.logger);
      await this.finish(job.code, applied, staged, read.yaml);
      return { problemId: applied.problemId, code: job.code };
    } catch (error) {
      if (!committed) await this.undo(job, savedImages, staged);
      throw error;
    } finally {
      await pkg.close();
    }
  }

  /** Everything that can fail before a file is staged: problem.xml, the test plan, statements (images are saved as found) and init.yml. */
  private async readPackage(
    pkg: PolygonPackage,
    job: PolygonImportJob,
    savedImages: string[],
  ): Promise<ReadPackage> {
    const root = await pkg.problemXml();
    const assets = parseAssets(root);
    const plan = planTests(root, job);
    if (
      !plan.tests.every(
        (test) => pkg.has(test.inputPath) && pkg.has(test.answerPath),
      )
    )
      throw new PolygonImportError('not full package');
    const { tutorial, ...statement } = await this.readStatements(
      root,
      pkg,
      job,
      savedImages,
    );
    const data = dataOf(assets, plan);
    const compiled = this.compile(data, plan.tests);
    return {
      tests: plan.tests,
      assets,
      yaml: compiled.yaml,
      imported: {
        ...statement,
        solution: this.renderTutorial(tutorial),
        timeLimit: plan.timeLimit,
        memoryLimit: plan.memoryLimit,
        partial: plan.partial,
        data: { ...data, cases: compiled.cases },
      },
    };
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

  /** Everything after the commit: a failure here leaves the problem imported, so it is logged with its cause and reported to the requester as an import that needs attention, never as "Import failed". The data steps run under the judge's writing marker, ending with the stamp. */
  private async finish(
    code: string,
    applied: AppliedImport,
    staged: StagedFile[],
    yaml: string | null,
  ): Promise<void> {
    await this.dataFiles.withDataWrite(code, async () => {
      await this.runSteps(code, this.dataSteps(code, applied, staged, yaml));
      await this.recordDataBytes(applied.problemId, code);
    });
    await this.runSteps(code, [
      ['dropping the cached PDFs', () => this.dropPdfs(code)],
    ]);
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

  private dataSteps(
    code: string,
    applied: AppliedImport,
    staged: StagedFile[],
    yaml: string | null,
  ): Array<[string, () => Promise<unknown>]> {
    const kept = new Set(staged.map(({ name }) => name));
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

  private async stageFiles(
    code: string,
    pkg: PolygonPackage,
    tests: PlannedTest[],
    assets: PolygonAssets,
  ): Promise<StagedFile[]> {
    const staged: StagedFile[] = [];
    const stage = async (name: string, content: Buffer | Readable) => {
      const stagedPath = await this.dataFiles.stageUpload(code);
      staged.push({ name, stagedPath });
      await writeFileAtomically(stagedPath, content);
    };
    try {
      await stage(TESTS_ARCHIVE, repackTests(pkg, tests));
      if (assets.checkerSource)
        await stage(
          CHECKER_FILE,
          await pkg.read(assets.checkerSource, SOURCE_MAX_BYTES),
        );
      if (assets.interactorSource)
        await stage(
          INTERACTOR_FILE,
          await pkg.read(assets.interactorSource, SOURCE_MAX_BYTES),
        );
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
