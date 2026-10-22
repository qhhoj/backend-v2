import { Inject, Injectable } from '@nestjs/common';
import { SettingsService } from '@libs/settings';
import { ExternalJudgeError, errorCodeOfStatus } from './external-judge.error';
import {
  remoteOjsOf,
  remoteProblemOf,
  remoteProblemPageOf,
  remoteRunOf,
  unwrapData,
} from './external-judge-types';
import type {
  RemoteOj,
  RemoteProblem,
  RemoteProblemPage,
  RemoteRun,
} from './external-judge-types';

/** The `fetch` the client sends with; a test provides a fake external judge here. */
export const EXTERNAL_JUDGE_FETCH = Symbol('EXTERNAL_JUDGE_FETCH');
export type ExternalJudgeFetch = typeof fetch;

/** A submit may wait for the remote OJ; reads are quick. */
export const SUBMIT_TIMEOUT_MS = 30_000;
export const READ_TIMEOUT_MS = 10_000;
export const SEARCH_PAGE_SIZE = 20;

export interface ExternalSubmitRequest {
  oj: string;
  problemId: string;
  /** The remote OJ's language id. */
  language: string;
  source: string;
}

interface RequestOptions {
  query?: Record<string, string>;
  body?: unknown;
  timeoutMs: number;
}

/** The PCD VJudge API of the `externalJudge.*` settings (legacy `ExternalJudgeClient`). The token travels only in the Authorization header; redirects are refused, so it never reaches another host. */
@Injectable()
export class ExternalJudgeClient {
  constructor(
    @Inject(SettingsService)
    private readonly settings: Pick<SettingsService, 'get'>,
    @Inject(EXTERNAL_JUDGE_FETCH) private readonly fetchFn: ExternalJudgeFetch,
  ) {}

  isConfigured(): boolean {
    return this.connection() !== null;
  }

  async ojs(): Promise<RemoteOj[]> {
    return remoteOjsOf(
      await this.request('GET', '/api/v1/ojs', { timeoutMs: READ_TIMEOUT_MS }),
    );
  }

  async search(
    { oj, problemId }: { oj: string; problemId: string },
    page: number,
  ): Promise<RemoteProblemPage> {
    const body = await this.request('GET', '/api/v1/problems', {
      query: {
        oj,
        problemId,
        title: '',
        source: '',
        page: String(page),
        pageSize: String(SEARCH_PAGE_SIZE),
      },
      timeoutMs: READ_TIMEOUT_MS,
    });
    return remoteProblemPageOf(body, page);
  }

  /** The problem's title and languages; with no languages of its own, its OJ's from `/ojs` (legacy verify). */
  async problem(oj: string, problemId: string): Promise<RemoteProblem> {
    const problem = remoteProblemOf(
      await this.request(
        'GET',
        `/api/v1/problems/${segment(oj)}/${segment(problemId)}`,
        {
          timeoutMs: READ_TIMEOUT_MS,
        },
      ),
      oj,
      problemId,
    );
    if (problem.languages.length) return problem;
    const ojs = await this.ojs().catch((): RemoteOj[] => []);
    const entry = ojs.find(
      (item) => item.oj.toLowerCase() === oj.toLowerCase(),
    );
    return { ...problem, languages: entry?.languages ?? [] };
  }

  async submit(request: ExternalSubmitRequest): Promise<RemoteRun> {
    return remoteRunOf(
      await this.request('POST', '/api/v1/submissions', {
        body: {
          oj: request.oj,
          problemId: request.problemId,
          language: request.language,
          source: request.source,
          open: true,
        },
        timeoutMs: SUBMIT_TIMEOUT_MS,
      }),
    );
  }

  async status(remoteId: string): Promise<RemoteRun> {
    return remoteRunOf(
      await this.request(
        'GET',
        `/api/v1/submissions/${segment(remoteId)}/status`,
        {
          timeoutMs: READ_TIMEOUT_MS,
        },
      ),
    );
  }

  private connection(): { baseUrl: string; token: string } | null {
    const baseUrl = this.settings.get('externalJudge.baseUrl');
    const token = this.settings.get('externalJudge.apiToken');
    return baseUrl && token ? { baseUrl, token } : null;
  }

  private async request(
    method: 'GET' | 'POST',
    path: string,
    { query, body, timeoutMs }: RequestOptions,
  ): Promise<unknown> {
    const connection = this.connection();
    if (!connection)
      throw new ExternalJudgeError('external_judge_not_configured');
    const url = new URL(connection.baseUrl + path);
    for (const [name, value] of Object.entries(query ?? {}))
      url.searchParams.set(name, value);
    let response: Response;
    try {
      response = await this.fetchFn(url, {
        method,
        headers: {
          Authorization: `Bearer ${connection.token}`,
          Accept: 'application/json',
          ...(body !== undefined && { 'Content-Type': 'application/json' }),
        },
        ...(body !== undefined && { body: JSON.stringify(body) }),
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new ExternalJudgeError('external_judge_unavailable');
    }
    if (!response.ok)
      throw new ExternalJudgeError(
        errorCodeOfStatus(response.status),
        response.status,
      );
    const parsed: unknown = await response.json().catch(() => {
      throw new ExternalJudgeError(
        'external_judge_unavailable',
        response.status,
      );
    });
    return unwrapData(parsed);
  }
}

/** One escaped path segment; `.` and `..` are refused, as `new URL` would resolve them to another API path (no problem or run has such an id). */
function segment(value: string): string {
  if (value === '.' || value === '..')
    throw new ExternalJudgeError('external_judge_not_found');
  return encodeURIComponent(value);
}
