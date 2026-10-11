import { Injectable } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { ZipFile } from 'yazl';
import { COMPILE_FEATURE } from '@libs/judging';
import { ProblemDataFilesService } from '@libs/problems';
import type { SourceCheckJob } from '@libs/problems';
import { TestGenerationRepository } from '../polygon-import/test-generation.repository';
import { TestGenerationService } from '../polygon-import/test-generation.service';
import { checkOf, compileCheckPlan } from './source-check-plan';
import { SourceCheckRepository } from './source-check.repository';

/** Compiles an uploaded checker or interactor on a judge and records ok, the compile log, or why no judge could. */
@Injectable()
export class SourceCheckService {
  constructor(
    private readonly rows: SourceCheckRepository,
    private readonly dataFiles: ProblemDataFilesService,
    private readonly generations: TestGenerationService,
    private readonly judges: TestGenerationRepository,
  ) {}

  async check(job: SourceCheckJob): Promise<void> {
    const code = await this.rows.codeIfCurrent(job);
    if (!code) return;
    const plan = compileCheckPlan(job);
    if (!plan || !(await this.judges.hasCapableJudge(COMPILE_FEATURE)))
      return this.rows.record(job, checkOf({ kind: 'no-judge' }, job.file));
    const source = await readFile(this.dataFiles.pathOf(code, job.file));
    const end = await this.generations.run(plan, bundleOf(job.file, source));
    await this.rows.record(job, checkOf(end, job.file));
  }
}

/** The bundle holds the one source at the plan's `sourcePath`. */
function bundleOf(name: string, content: Buffer): Readable {
  const zip = new ZipFile();
  zip.addBuffer(content, name);
  zip.end();
  return zip.outputStream as Readable;
}
