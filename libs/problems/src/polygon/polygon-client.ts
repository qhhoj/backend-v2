import { Inject, Injectable, Logger } from '@nestjs/common';
import { SettingsService } from '@libs/settings';
import { failureOf, PolygonApiError } from './polygon-api.error';
import type { PolygonErrorCode } from './polygon-api.error';
import { failureTextOf, IdleWatch, writeCappedBody } from './polygon-download';
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
/** A download fails after this long without a byte (headers or body); a slow one that keeps moving runs to the end. */
const DOWNLOAD_IDLE_MS = 60_000;
/** How much of an error page the log keeps: enough to tell a Cloudflare page from a Polygon one. */
const LOGGED_BODY_CHARS = 160;

/** Signed access to the one Polygon account in the `polygon.*` settings; read methods only. */
@Injectable()
export class PolygonClient {
  private readonly logger = new Logger(PolygonClient.name);

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
   * no Linux variant (a standard package). A download idle for `idleMs` (default a minute) is `polygon_unavailable`.
   */
  async downloadPackage(
    { problemId, packageId }: { problemId: number; packageId: number },
    destination: string,
    options: {
      maxBytes: number;
      onProgress?: DownloadProgress;
      type?: 'linux' | 'standard';
      idleMs?: number;
    },
  ): Promise<void> {
    const method = 'problem.package';
    const type = options.type ?? IMPORT_PACKAGE_TYPE;
    const watch = new IdleWatch(options.idleMs ?? DOWNLOAD_IDLE_MS);
    try {
      const response = await this.post(
        method,
        { problemId: String(problemId), packageId: String(packageId), type },
        watch.signal,
      );
      const label = `${method} for package ${packageId} of problem ${problemId} (type ${type})`;
      if (!response.ok || !isArchive(response))
        await this.unwrap(label, response, 'polygon_package_unavailable');
      await writeCappedBody(response, destination, {
        ...options,
        onData: () => watch.touch(),
      });
    } finally {
      watch.stop();
    }
  }

  private async call<Result>(
    method: string,
    params: Record<string, string>,
  ): Promise<Result> {
    return this.unwrap<Result>(
      method,
      await this.post(method, params, AbortSignal.timeout(CALL_TIMEOUT_MS)),
    );
  }

  /** POST with a form body keeps the key and signature out of URLs and logs. */
  private async post(
    method: string,
    params: Record<string, string>,
    signal: AbortSignal,
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
        signal,
      });
    } catch (error) {
      const message = `Polygon did not answer ${method}: ${failureTextOf(error)}`;
      this.logger.warn(message);
      throw new PolygonApiError('polygon_unavailable', message);
    }
  }

  /**
   * `result` of an OK envelope; a FAILED one (Polygon sends it with HTTP 200 or 400, as text/html) or any other body
   * throws. Any other body (an HTTP error page from Polygon or Cloudflare) is `unreadable`, logged with its status.
   */
  private async unwrap<Result>(
    method: string,
    response: Response,
    unreadable: PolygonErrorCode = 'polygon_unavailable',
  ): Promise<Result> {
    const body = await response.text().catch(() => '');
    const envelope = envelopeOf<Result>(body);
    if (envelope?.status === 'OK') return envelope.result as Result;
    if (envelope?.status === 'FAILED')
      throw failureOf(method, envelope.comment);
    const contentType = response.headers.get('content-type') ?? 'no type';
    const message = `Polygon answered ${method} with HTTP ${response.status}`;
    this.logger.warn(
      `${message} (${contentType}): ${body.replace(/\s+/g, ' ').slice(0, LOGGED_BODY_CHARS)}`,
    );
    throw new PolygonApiError(unreadable, message);
  }

  private credentials(): PolygonCredentials | null {
    const apiKey = this.settings.get('polygon.apiKey');
    const apiSecret = this.settings.get('polygon.apiSecret');
    return apiKey && apiSecret ? { apiKey, apiSecret } : null;
  }
}

/** A package answers as a zip; Polygon's FAILED envelope comes as JSON or text/html, whatever the status. */
const isArchive = (response: Response): boolean => {
  const type = response.headers.get('content-type') ?? '';
  return !type.includes('json') && !type.startsWith('text/');
};

function envelopeOf<Result>(
  body: string,
): { status?: string; comment?: unknown; result?: Result } | null {
  try {
    return JSON.parse(body) as { status?: string; result?: Result };
  } catch {
    return null;
  }
}
