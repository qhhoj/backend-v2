import { stat } from 'node:fs/promises';
import { Inject, Injectable } from '@nestjs/common';
import { assertRealPathInside, ENV, StorageService } from '@libs/common';
import type { WorkerConfig } from '@libs/common';
import { DATA_FILE_KINDS } from '@libs/database';
import type { DataFileKind, Problem } from '@libs/database';
import {
  buildManifest,
  materialName,
  PACKAGE_MAX_AGE_MS,
  packageKey,
  PackageCacheService,
  packageStatements,
  PdfCacheService,
  ProblemDataFilesService,
} from '@libs/problems';
import type { CachedPdf, ProblemPackageJob } from '@libs/problems';
import { PACKAGE_LIMITS, writePackageZip } from './package-zip';
import type { PackageEntry, PackageLimits } from './package-zip';
import { ProblemPackageRepository } from './problem-package.repository';

/** Checker, grader and header sources, and the generator: the files beside the tests. */
const SOURCE_KINDS: readonly DataFileKind[] = DATA_FILE_KINDS.filter(
  (kind) => kind !== 'archive',
);

/** Size of a file that really sits inside `root` (a symlink out of the root throws, as everywhere else files are served); null when it does not exist. */
async function sizeInside(root: string, path: string): Promise<number | null> {
  await assertRealPathInside(root, path);
  return stat(path).then(
    ({ size }) => size,
    () => null,
  );
}

@Injectable()
export class ProblemPackageService {
  constructor(
    private readonly repository: ProblemPackageRepository,
    private readonly dataFiles: ProblemDataFilesService,
    private readonly pdfCache: PdfCacheService,
    private readonly packages: PackageCacheService,
    private readonly storage: StorageService,
    @Inject(PACKAGE_LIMITS) private readonly limits: PackageLimits,
    @Inject(ENV) private readonly env: WorkerConfig,
  ) {}

  /** Builds `<code>.<key>.zip` for the problem as it is now (the key in the job only says what the api saw; an edit since then simply produces the newer key). Returns the key written. */
  async build(job: ProblemPackageJob): Promise<string> {
    const problem = await this.repository.findByCode(job.code);
    if (!problem) throw new Error('problem not found');
    const pdfs = await this.pdfCache.listing(problem.code);
    const key = packageKey(problem, pdfs);
    if (await this.packages.has(problem.code, key)) return key;
    await this.assertDataFinished(problem);
    const entries = await this.entriesOf(problem, pdfs);
    await this.packages.write(problem.code, key, async (temporaryPath) => {
      await writePackageZip(entries, {
        path: temporaryPath,
        maxBytes: this.limits.maxBytes,
      });
      await this.assertDataFinished(problem);
    });
    return key;
  }

  /**
   * Checked before the files are read and again before the zip takes its name, so a data write that overlaps the build
   * never leaves its files cached under the key: refused while the judges' writing marker is up, or when the stamp is not
   * the `dataVersion` read (a write landed meanwhile, or one stopped after its Mongo write). An unstamped directory is
   * read as it is, as judges do. The failed job is built again on the editor's next request. No data lock is taken: the
   * bridge would hold the problem's submissions for the whole build.
   */
  private async assertDataFinished(problem: Problem): Promise<void> {
    const isWriting = await this.dataFiles.isWriting(problem.code);
    const stamp = await this.dataFiles.readDataVersion(problem.code);
    if (isWriting || (stamp !== null && stamp !== (problem.dataVersion ?? 0)))
      throw new Error(`the data of ${problem.code} is being written`);
  }

  /** The daily sweep: packages nobody asked for in a day. */
  sweep(): Promise<number> {
    return this.packages.deleteOlderThan(PACKAGE_MAX_AGE_MS);
  }

  private async entriesOf(
    problem: Problem,
    pdfs: readonly CachedPdf[],
  ): Promise<PackageEntry[]> {
    return [
      {
        name: 'package.json',
        text: JSON.stringify(buildManifest(problem), null, 2),
      },
      ...packageStatements(problem).map(({ file, text }) => ({
        name: file,
        text,
      })),
      ...(await this.dataEntries(problem)),
      ...pdfs.map(({ language, path, bytes }) => ({
        name: `statement.${language}.pdf`,
        path,
        bytes,
      })),
      ...(await this.uploadEntries(problem)),
    ];
  }

  /** The test archive and `init.yml` under `data/`, the other named files and the helper headers under `sources/`; a name the data row lists but the directory lacks is left out. */
  private async dataEntries(problem: Problem): Promise<PackageEntry[]> {
    const named: Array<[string, string]> = [['data/init.yml', 'init.yml']];
    const data = problem.data;
    if (data?.archive) named.push([`data/${data.archive}`, data.archive]);
    const sources = [
      ...SOURCE_KINDS.map((kind) => data?.[kind]),
      ...(data?.helperHeaders ?? []),
    ];
    for (const file of sources) if (file) named.push([`sources/${file}`, file]);
    const entries: PackageEntry[] = [];
    for (const [name, file] of named) {
      const path = this.dataFiles.pathOf(problem.code, file);
      const bytes = await sizeInside(this.env.problemDataRoot, path);
      if (bytes !== null) entries.push({ name, path, bytes });
    }
    return entries;
  }

  private async uploadEntries(problem: Problem): Promise<PackageEntry[]> {
    const uploads: Array<[string | null, string, 'pdf' | 'materials']> = [
      [problem.materialUrl, 'material', 'materials'],
      [problem.pdfStatementUrl, 'statements/uploaded.pdf', 'pdf'],
    ];
    const entries: PackageEntry[] = [];
    for (const [url, target, kind] of uploads) {
      const relative = this.storage.relativePathOf(url, kind);
      if (!relative) continue;
      const path = this.storage.absolutePathOf(relative);
      const bytes = await sizeInside(this.env.mediaRoot, path);
      if (bytes === null) continue;
      const name =
        kind === 'materials' ? `${target}/${materialName(url)}` : target;
      entries.push({ name, path, bytes });
    }
    return entries;
  }
}
