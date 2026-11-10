import { stat } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { Inject, Injectable } from '@nestjs/common';
import {
  assertRealPathInside,
  ENV,
  JobFailure,
  StorageService,
} from '@libs/common';
import type { WorkerConfig } from '@libs/common';
import { DATA_FILE_KINDS } from '@libs/database';
import type { DataFileKind, Problem } from '@libs/database';
import {
  buildManifest,
  materialName,
  PACKAGE_DATA_UNSAVED,
  PACKAGE_DATA_WRITING,
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

/** A data write's marker was up during a build: worth building again once it is down. */
class DataWriteUnderWay extends Error {}

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

  /** Builds `<code>.<key>.zip` for the problem as it is now (the key in the job only says what the api saw; an edit since then simply produces the newer key). Returns the key written. A data write under way is waited out, up to `dataWaitAttempts` builds `dataWaitMs` apart, then the job fails with `PACKAGE_DATA_WRITING`. */
  async build(job: ProblemPackageJob): Promise<string> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.buildOnce(job);
      } catch (error) {
        if (!(error instanceof DataWriteUnderWay)) throw error;
        if (attempt >= this.limits.dataWaitAttempts)
          throw new JobFailure(PACKAGE_DATA_WRITING);
        await sleep(this.limits.dataWaitMs);
      }
    }
  }

  private async buildOnce(job: ProblemPackageJob): Promise<string> {
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
   * Checked before the files are read and again before the zip takes its name, so a data write under way never leaves
   * its files cached under the current key (`DataState`): a write's marker is waited out (`build`); a stamp behind the
   * `dataVersion` read (a save that stopped after its Mongo write, its files maybe half moved) fails with
   * `PACKAGE_DATA_UNSAVED` until the next save. A stamp ahead is finished, as judges read it: a write that lands during
   * the build leaves its zip under the older key, which the api no longer asks for. No data lock is taken: the bridge
   * would hold the problem's submissions for the whole build.
   */
  private async assertDataFinished(problem: Problem): Promise<void> {
    const state = await this.dataFiles.dataState(
      problem.code,
      problem.dataVersion ?? 0,
    );
    if (state === 'writing') throw new DataWriteUnderWay();
    if (state === 'unsaved') throw new JobFailure(PACKAGE_DATA_UNSAVED);
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
