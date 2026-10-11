import { Inject, Injectable } from '@nestjs/common';
import { REDIS } from '@libs/common';
import type Redis from 'ioredis';
import { LanguagesQuerier } from '../../problems/catalog/languages.querier';
import { JudgesRepository } from '../judges.repository';
import type { PublicJudgeRow } from '../judges.repository';
import {
  RuntimeJudgeResponse,
  RuntimeLanguageResponse,
  RuntimesResponse,
} from './dto/runtimes.response';

const MS_PER_SECOND = 1000;
export const RUNTIMES_CACHE_KEY = 'runtimes:overview';
/** Every visitor polls every few seconds: one shared answer this long is the rate limit. */
export const RUNTIMES_CACHE_SECONDS = 3;

const judgeView = (judge: PublicJudgeRow): RuntimeJudgeResponse => ({
  name: judge.name,
  online: judge.online,
  slots: judge.slots,
  busy: judge.online ? judge.busy : 0,
  pingMs:
    judge.online && judge.ping !== null
      ? Math.round(judge.ping * MS_PER_SECOND)
      : null,
  startedAt: judge.online ? judge.startTime : null,
});

/** The public page: what each judge and language is, never keys, addresses or builds. */
@Injectable()
export class RuntimesService {
  constructor(
    private readonly judges: JudgesRepository,
    private readonly languages: LanguagesQuerier,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async overview(): Promise<RuntimesResponse> {
    const cached = await this.redis.get(RUNTIMES_CACHE_KEY);
    if (cached !== null) return JSON.parse(cached) as RuntimesResponse;
    const overview = await this.compute();
    await this.redis.set(
      RUNTIMES_CACHE_KEY,
      JSON.stringify(overview),
      'EX',
      RUNTIMES_CACHE_SECONDS,
    );
    return overview;
  }

  private async compute(): Promise<RuntimesResponse> {
    const judges = await this.judges.listPublic();
    return {
      judges: judges.map(judgeView),
      languages: this.languages
        .all()
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((language): RuntimeLanguageResponse => ({
          key: language.key,
          name: language.name,
          commonName: language.commonName,
          extension: language.extension,
          fileOnly: language.fileOnly,
          versions: judges.flatMap((judge) =>
            judge.runtimes
              .filter((runtime) => runtime.language === language.key)
              .map((runtime) => ({
                judge: judge.name,
                compiler: runtime.name,
                version: runtime.version,
              })),
          ),
        })),
    };
  }
}
