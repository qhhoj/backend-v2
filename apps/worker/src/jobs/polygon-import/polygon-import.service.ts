import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { rm } from 'node:fs/promises';
import { StorageService, writeFileAtomically } from '@libs/common';
import { emptyProblemData, newId, STATEMENT_LANGUAGES } from '@libs/database';
import type { ProblemData } from '@libs/database';
import {
  compileInitYaml,
  extensionOf,
  PDF_QUEUE,
  PdfCacheService,
  pdfJobId,
  ProblemDataError,
  ProblemDataFilesService,
} from '@libs/problems';
import type {
  PdfRenderJob,
  PolygonImportJob,
  PolygonImportResult,
} from '@libs/problems';
import type { Readable } from 'node:stream';
import type { RenderStyle } from '@libs/render';
import { PandocService } from './pandoc.service';
import { parseAssets } from './polygon-assets';
import type { PolygonAssets } from './polygon-assets';
import { PolygonImportError } from './polygon-import.error';
import { PolygonImportRepository } from './polygon-import.repository';
import type { ImportedProblem } from './polygon-import.repository';
import {
  CHECKER_FILE,
  INTERACTOR_FILE,
  PolygonPackage,
  repackTests,
  SOURCE_MAX_BYTES,
  TESTS_ARCHIVE,
} from './polygon-package';
import {
  mainSolution,
  parseStatements,
  renderStatement,
  withMainSolution,
} from './polygon-statements';
import type { ImportedStatements } from './polygon-statements';
import { planTests } from './polygon-tests';
import type { PlannedTest } from './polygon-tests';

/** A data file written beside the final one and renamed into place only after the transaction matched. */
interface StagedFile {
  name: string;
  stagedPath: string;
}

@Injectable()
export class PolygonImportService {
  constructor(
    private readonly pandoc: PandocService,
    private readonly storage: StorageService,
    private readonly dataFiles: ProblemDataFilesService,
    private readonly pdfCache: PdfCacheService,
    private readonly repository: PolygonImportRepository,
    @InjectQueue(PDF_QUEUE) private readonly pdfQueue: Queue<PdfRenderJob>,
  ) {}

  /** Pre-checks that cost nothing come first; the uploaded package is removed however the job ends. */
  async import(job: PolygonImportJob): Promise<PolygonImportResult> {
    try {
      await this.pandoc.assertAvailable();
      const target = await this.repository.resolveTarget(job);
      await this.repository.assertFullMarkupWriter(job);
      return await this.run(job, target);
    } finally {
      await rm(job.packagePath, { force: true });
    }
  }

  /**
   * Parse, render and compile everything that can fail without touching the database; then stage the data files, run the transaction, and only after it committed give the files their final names and write init.yml.
   * Before the commit a failure removes the images and staged files it saved; after it, Mongo is authoritative and nothing it references is removed.
   */
  private async run(
    job: PolygonImportJob,
    target: Awaited<ReturnType<PolygonImportRepository['resolveTarget']>>,
  ): Promise<PolygonImportResult> {
    const pkg = await PolygonPackage.open(job.packagePath);
    const savedImages: string[] = [];
    const staged: StagedFile[] = [];
    let committed = false;
    try {
      const root = await pkg.problemXml();
      const assets = parseAssets(root);
      const plan = planTests(root, job);
      if (
        !plan.tests.every(
          (test) => pkg.has(test.inputPath) && pkg.has(test.answerPath),
        )
      )
        throw new PolygonImportError('not full package');
      const statements = await parseStatements(
        root,
        pkg,
        job,
        (tex) => this.pandoc.texToMarkdown(tex),
        this.imageSaver(savedImages),
      );
      if (job.appendMainSolution) {
        const solution = await mainSolution(root, pkg);
        statements.tutorial = withMainSolution(
          statements.tutorial,
          solution.code,
          solution.sourceType,
        );
      }
      const data: ProblemData = {
        ...emptyProblemData(),
        archive: TESTS_ARCHIVE,
        checker: assets.checker,
        checkerArgs: assets.checkerArgs,
        customChecker: assets.checkerSource ? CHECKER_FILE : null,
        grader: assets.grader,
        customGrader: assets.interactorSource ? INTERACTOR_FILE : null,
        graderArgs: plan.graderArgs,
        cases: plan.cases,
      };
      const compiled = this.compile(data, plan.tests);
      const imported: ImportedProblem = {
        ...this.renderStatements(statements, job.isFullMarkup),
        timeLimit: plan.timeLimit,
        memoryLimit: plan.memoryLimit,
        partial: plan.partial,
        data: { ...data, cases: compiled.cases },
      };
      staged.push(
        ...(await this.stageFiles(job.code, pkg, plan.tests, assets)),
      );
      const applied = await this.repository.apply(job, imported, target);
      committed = true;
      for (const { name, stagedPath } of staged)
        await this.dataFiles.commitUpload(job.code, stagedPath, name);
      const kept = new Set(staged.map(({ name }) => name));
      for (const name of applied.previousFiles)
        if (!kept.has(name)) await this.dataFiles.removeFile(job.code, name);
      if (compiled.yaml === null) await this.dataFiles.removeInit(job.code);
      else await this.dataFiles.writeInit(job.code, compiled.yaml);
      await this.dropPdfs(job.code);
      return { problemId: applied.problemId, code: job.code };
    } catch (error) {
      if (!committed)
        await this.undo(job, savedImages, staged, target === null);
      throw error;
    } finally {
      pkg.close();
    }
  }

  /** Images the statement references are saved as they are found, so a failed job must take them back. */
  private async undo(
    job: PolygonImportJob,
    savedImages: string[],
    staged: StagedFile[],
    isCreate: boolean,
  ): Promise<void> {
    await Promise.all([
      ...savedImages.map((relativePath) => this.storage.delete(relativePath)),
      ...staged.map(({ stagedPath }) => rm(stagedPath, { force: true })),
    ]).catch(() => undefined);
    if (isCreate)
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

  /** The editor's render path and limits (`parseStatements` already applied them to the description, translations and tutorial; the appended solution source is new text), style following the target problem. */
  private renderStatements(
    statements: ImportedStatements,
    isFullMarkup: boolean,
  ): Pick<
    ImportedProblem,
    'name' | 'description' | 'descriptionHtml' | 'translations' | 'solution'
  > {
    const style: RenderStyle = isFullMarkup ? 'problem-full' : 'problem';
    const tutorial = statements.tutorial.trim();
    return {
      name: statements.name,
      description: statements.description,
      descriptionHtml: renderStatement(
        statements.description,
        style,
        'description',
      ),
      translations: statements.translations.map((translation) => ({
        ...translation,
        descriptionHtml: renderStatement(
          translation.description,
          style,
          `statement ${translation.language}`,
        ),
      })),
      solution: tutorial
        ? {
            content: tutorial,
            contentHtml: renderStatement(tutorial, 'solution', 'tutorial'),
          }
        : null,
    };
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
