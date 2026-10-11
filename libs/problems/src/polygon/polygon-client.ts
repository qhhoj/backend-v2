import { Inject, Injectable } from '@nestjs/common';
import { SettingsService } from '@libs/settings';
import { failureOf, PolygonApiError } from './polygon-api.error';
import { writeCappedBody } from './polygon-download';
import type { DownloadProgress } from './polygon-download';
import { randomSalt, signPolygonParams } from './polygon-signature';
import type { PolygonCredentials } from './polygon-signature';
import { IMPORT_PACKAGE_TYPE } from './polygon-types';
import type {
  PolygonPackageInfo,
  PolygonProblem,
  PolygonStatement,
} from './polygon-types';

const POLYGON_API_URL = 'https://polygon.codeforces.com/api/';
/** The `fetch` the client sends with; a test provides a fake Polygon here. */
export const POLYGON_FETCH = Symbol('POLYGON_FETCH');
export type PolygonFetch = typeof fetch;

const CALL_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 10 * 60_000;

/** Signed access to the one Polygon account in the `polygon.*` settings; read methods only. */
@Injectable()
export class PolygonClient {
  constructor(
    @Inject(SettingsService)
    private readonly settings: Pick<SettingsService, 'get'>,
    @Inject(POLYGON_FETCH) private readonly fetchFn: PolygonFetch,
  ) {}

  isConnected(): boolean {
    return this.credentials() !== null;
  }

  accountName(): string {
    return this.settings.get('polygon.accountName');
  }

  /** Every problem the account can read; deleted ones are left out by Polygon's default. */
  problems(): Promise<PolygonProblem[]> {
    return this.call('problems.list', {});
  }

  /** One problem the account can read, or null (unknown id, or not shared with the account). */
  async problem(problemId: number): Promise<PolygonProblem | null> {
    const found = await this.call<PolygonProblem[]>('problems.list', {
      id: String(problemId),
    });
    return found.find((problem) => problem.id === problemId) ?? null;
  }

  /** The problem `owner/name` the account can read, or null (no such problem, or not shared). Polygon filters; the owner is matched here ignoring case, as a pasted handle may differ in case. */
  async problemNamed(
    owner: string,
    name: string,
  ): Promise<PolygonProblem | null> {
    const found = await this.call<PolygonProblem[]>('problems.list', {
      owner,
      name,
    });
    return (
      found.find(
        (problem) =>
          problem.name === name &&
          problem.owner.toLowerCase() === owner.toLowerCase() &&
          !problem.deleted,
      ) ?? null
    );
  }

  packages(problemId: number): Promise<PolygonPackageInfo[]> {
    return this.call('problem.packages', { problemId: String(problemId) });
  }

  statements(problemId: number): Promise<Record<string, PolygonStatement>> {
    return this.call('problem.statements', { problemId: String(problemId) });
  }

  /**
   * A package streamed to `destination`: by default the full package with tests generated for Linux (`type=linux`);
   * `standard` exists for every package. A failure answers JSON instead of a zip, or HTTP 500 when the package has
   * no Linux variant (a standard package).
   */
  async downloadPackage(
    { problemId, packageId }: { problemId: number; packageId: number },
    destination: string,
    options: {
      maxBytes: number;
      onProgress?: DownloadProgress;
      type?: 'linux' | 'standard';
    },
  ): Promise<void> {
    const method = 'problem.package';
    const type = options.type ?? IMPORT_PACKAGE_TYPE;
    const response = await this.post(
      method,
      { problemId: String(problemId), packageId: String(packageId), type },
      DOWNLOAD_TIMEOUT_MS,
    );
    const label = `${method} for package ${packageId} of problem ${problemId} (type ${type})`;
    if (!response.ok || isJson(response)) await this.unwrap(label, response);
    await writeCappedBody(response, destination, options);
  }

  private async call<Result>(
    method: string,
    params: Record<string, string>,
  ): Promise<Result> {
    return this.unwrap<Result>(
      method,
      await this.post(method, params, CALL_TIMEOUT_MS),
    );
  }

  /** POST with a form body keeps the key and signature out of URLs and logs. */
  private async post(
    method: string,
    params: Record<string, string>,
    timeoutMs: number,
  ): Promise<Response> {
    const credentials = this.credentials();
    if (!credentials)
      throw new PolygonApiError(
        'polygon_not_connected',
        'Polygon is not connected: set polygon.apiKey and polygon.apiSecret',
      );
    const body = new URLSearchParams(
      signPolygonParams(method, params, credentials, randomSalt()),
    );
    try {
      return await this.fetchFn(POLYGON_API_URL + method, {
        method: 'POST',
        body,
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new PolygonApiError(
        'polygon_unavailable',
        `Polygon did not answer ${method}`,
      );
    }
  }

  /** `result` of an OK envelope; a FAILED one (Polygon sends it with HTTP 200 or 400) or any other body throws. */
  private async unwrap<Result>(
    method: string,
    response: Response,
  ): Promise<Result> {
    const envelope = (await response.json().catch(() => null)) as {
      status?: string;
      comment?: unknown;
      result?: Result;
    } | null;
    if (envelope?.status === 'OK') return envelope.result as Result;
    if (envelope?.status === 'FAILED')
      throw failureOf(method, envelope.comment);
    throw new PolygonApiError(
      'polygon_unavailable',
      `Polygon answered ${method} with HTTP ${response.status}`,
    );
  }

  private credentials(): PolygonCredentials | null {
    const apiKey = this.settings.get('polygon.apiKey');
    const apiSecret = this.settings.get('polygon.apiSecret');
    return apiKey && apiSecret ? { apiKey, apiSecret } : null;
  }
}

const isJson = (response: Response): boolean =>
  (response.headers.get('content-type') ?? '').includes('json');
