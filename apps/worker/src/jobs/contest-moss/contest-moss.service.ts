import { Inject, Injectable } from '@nestjs/common';
import { ENV } from '@libs/common';
import type { Env } from '@libs/common';
import { MOSS_LANGUAGES } from '@libs/database';
import type { ContestMoss } from '@libs/database';
import { ContestMossRepository } from './contest-moss.repository';
import type { MossSource } from './contest-moss.repository';
import { MOSS_SERVER, MossError, submitToMoss } from './moss-client';
import type { MossFile, MossServer } from './moss-client';

/** Per batch; files past it are left out (MOSS itself rejects huge uploads). */
export const MOSS_MAX_BATCH_BYTES = 64 * 1024 * 1024;

@Injectable()
export class ContestMossService {
  constructor(
    private readonly repository: ContestMossRepository,
    @Inject(ENV) private readonly env: Env,
    @Inject(MOSS_SERVER) private readonly server: MossServer,
  ) {}

  /** Legacy `run_moss`: one batch per problem and MOSS language; the rows replace the old ones only after every batch succeeded. Returns the row count. */
  async run(contestId: string): Promise<number> {
    const userId = this.env.mossApiKey;
    if (!userId) throw new MossError('MOSS is not configured');
    const contest = await this.repository.findContest(contestId);
    if (!contest) return 0;
    const languages = await this.repository.languageIds();
    const rows: Array<Omit<ContestMoss, '_id'>> = [];
    for (const problem of contest.problems)
      for (const [language, mossLanguage] of MOSS_LANGUAGES) {
        const files = this.filesOf(
          await this.repository.bestSources(
            contest._id,
            problem.id,
            languages.get(language) ?? [],
          ),
        );
        const url = files.length
          ? await submitToMoss(this.server, {
              userId,
              language: mossLanguage,
              comment: `${contest.key} - ${problem.code}`,
              files,
            })
          : null;
        rows.push({
          contest: contest._id,
          problem: problem.id,
          language,
          submissionCount: files.length,
          url,
        });
      }
    await this.repository.replaceResults(contest._id, rows);
    return rows.length;
  }

  private filesOf(sources: MossSource[]): MossFile[] {
    const files: MossFile[] = [];
    let bytes = 0;
    for (const { submissionId, username, source } of sources) {
      const content = Buffer.from(
        `// ${this.env.siteUrl}/submission/${submissionId}\n${source}`,
      );
      if (bytes + content.length > MOSS_MAX_BATCH_BYTES) break;
      bytes += content.length;
      files.push({ name: username.replace(/[^\w.-]/g, '_') || '_', content });
    }
    return files;
  }
}
