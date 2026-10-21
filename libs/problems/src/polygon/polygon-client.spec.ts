import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { fakeSettings } from '@libs/settings/testing';
import { FakePolygon } from '../testing';
import { PolygonApiError } from './polygon-api.error';
import { PolygonClient } from './polygon-client';

const CONNECTED = { 'polygon.apiKey': 'KEY', 'polygon.apiSecret': 'SECRET' };

describe('PolygonClient', () => {
  let polygon: FakePolygon;
  let directory: string;
  const client = (settings = CONNECTED) =>
    new PolygonClient(fakeSettings(settings), polygon.fetch);
  const failureCode = (promise: Promise<unknown>) =>
    promise.then(
      () => 'resolved',
      (error: PolygonApiError) => error.code,
    );

  beforeEach(() => {
    polygon = new FakePolygon();
    directory = mkdtempSync(join(tmpdir(), 'polygon-client-'));
  });
  afterEach(() => rmSync(directory, { recursive: true, force: true }));

  it('is not connected until both key and secret are set, and then makes no call', async () => {
    expect(
      client({
        'polygon.apiKey': 'KEY',
        'polygon.apiSecret': '',
      }).isConnected(),
    ).toBe(false);
    expect(
      await failureCode(
        client({ 'polygon.apiKey': 'KEY', 'polygon.apiSecret': '' }).problems(),
      ),
    ).toBe('polygon_not_connected');
    expect(polygon.calls).toEqual([]);
    expect(client().isConnected()).toBe(true);
  });

  it('sends signed form fields and answers the result of an OK envelope', async () => {
    polygon.reply('problem.packages', {
      result: [{ id: 1, revision: 2, state: 'READY' }],
    });
    expect(await client().packages(42)).toEqual([
      { id: 1, revision: 2, state: 'READY' },
    ]);
    const [{ params }] = polygon.calls;
    expect(params).toMatchObject({ problemId: '42', apiKey: 'KEY' });
    expect(params.apiSig).toMatch(/^\d{6}[0-9a-f]{128}$/);
    expect(Math.abs(Number(params.time) - Date.now() / 1000)).toBeLessThan(5);
  });

  it.each([
    ['Incorrect signature', 'polygon_unauthorized'],
    ['apiKey: Unknown apiKey', 'polygon_unauthorized'],
    ['time: Wrong time, server time is 1700000000', 'polygon_clock_skew'],
    ['problemId: Problem not found', 'polygon_failed'],
  ])('maps the FAILED comment "%s" to %s', async (comment, code) => {
    polygon.reply('problems.list', { failed: comment });
    expect(await failureCode(client().problems())).toBe(code);
  });

  describe('when Polygon cannot be reached or answers an error page', () => {
    let warnings: string[];
    beforeEach(() => {
      warnings = [];
      jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(
          (message: unknown) => void warnings.push(String(message)),
        );
    });
    afterEach(() => jest.restoreAllMocks());

    const failureOf = (promise: Promise<unknown>) =>
      promise.then(
        () => null,
        (error: PolygonApiError) => ({
          code: error.code,
          message: error.message,
        }),
      );
    const offline = (reason: Error) =>
      new PolygonClient(fakeSettings(CONNECTED), () => Promise.reject(reason));

    it.each([
      [
        new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } }),
        'ENOTFOUND',
      ],
      [
        new TypeError('fetch failed', {
          cause: { code: 'UND_ERR_CONNECT_TIMEOUT' },
        }),
        'UND_ERR_CONNECT_TIMEOUT',
      ],
      [
        new DOMException('The operation timed out.', 'TimeoutError'),
        'timed out',
      ],
      [
        new TypeError('fetch failed', {
          cause: new Error('unexpected redirect'),
        }),
        'unexpected redirect',
      ],
    ])('names the network failure %#: %s', async (reason, named) => {
      expect(await failureOf(offline(reason).problems())).toEqual({
        code: 'polygon_unavailable',
        message: `Polygon did not answer problems.list: ${named}`,
      });
      expect(warnings).toEqual([
        `Polygon did not answer problems.list: ${named}`,
      ]);
    });

    it('logs the status, type and start of an error page, never the signed request', async () => {
      polygon.reply('problems.list', {
        status: 403,
        contentType: 'text/html; charset=UTF-8',
        page: '<!DOCTYPE html>\n<title>Just a moment...</title>',
      });
      expect(await failureOf(client().problems())).toEqual({
        code: 'polygon_unavailable',
        message: 'Polygon answered problems.list with HTTP 403',
      });
      expect(warnings).toEqual([
        'Polygon answered problems.list with HTTP 403 (text/html; charset=UTF-8): <!DOCTYPE html> <title>Just a moment...</title>',
      ]);
      expect(warnings.join()).not.toMatch(/KEY|SECRET|apiSig/);
    });
  });

  it('downloads the linux package to the destination and reports the bytes', async () => {
    const zip = Buffer.from('PK fake zip bytes');
    polygon.reply('problem.package', { zip });
    const progress: Array<[number, number | null]> = [];
    const destination = join(directory, 'package.zip');
    await client().downloadPackage(
      { problemId: 42, packageId: 9 },
      destination,
      {
        maxBytes: 1024,
        onProgress: (done, total) => progress.push([done, total]),
      },
    );
    expect(readFileSync(destination)).toEqual(zip);
    expect(polygon.calls[0].params).toMatchObject({
      problemId: '42',
      packageId: '9',
      type: 'linux',
    });
    expect(progress.at(-1)).toEqual([zip.length, zip.length]);
  });

  it('signs the download over its method and every form field, type included', async () => {
    polygon.reply('problem.package', { zip: Buffer.from('PK') });
    await client().downloadPackage(
      { problemId: 595937, packageId: 1500552 },
      join(directory, 'package.zip'),
      { maxBytes: 1024 },
    );
    const [{ method, params }] = polygon.calls;
    const { apiSig, ...signed } = params;
    expect(method).toBe('problem.package');
    expect(Object.keys(signed).sort()).toEqual([
      'apiKey',
      'packageId',
      'problemId',
      'time',
      'type',
    ]);
    const rand = apiSig.slice(0, 6);
    const query = `apiKey=KEY&packageId=1500552&problemId=595937&time=${signed.time}&type=linux`;
    expect(apiSig.slice(6)).toBe(
      createHash('sha512')
        .update(`${rand}/problem.package?${query}#SECRET`)
        .digest('hex'),
    );
  });

  it('reports a download Polygon answers with an HTTP error as the package being unavailable, naming it', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    polygon.reply('problem.package', { status: 500 });
    const failure = await client()
      .downloadPackage(
        { problemId: 595937, packageId: 1500552 },
        join(directory, 'package.zip'),
        { maxBytes: 1024 },
      )
      .catch((error: PolygonApiError) => error);
    expect(failure).toMatchObject({
      code: 'polygon_package_unavailable',
      message:
        'Polygon answered problem.package for package 1500552 of problem 595937 (type linux) with HTTP 500',
    });
    jest.restoreAllMocks();
  });

  describe('when the package body breaks off', () => {
    const zipResponse = (body: ReadableStream<Uint8Array>) =>
      Promise.resolve(
        new Response(body, {
          headers: { 'content-type': 'application/zip' },
        }),
      );
    const download = (fetchFn: typeof fetch, idleMs?: number) =>
      new PolygonClient(fakeSettings(CONNECTED), fetchFn)
        .downloadPackage(
          { problemId: 1, packageId: 1 },
          join(directory, 'package.zip'),
          { maxBytes: 4 * 1024 * 1024, idleMs },
        )
        .catch((error: PolygonApiError) => error);

    it('reports a connection reset in mid-body as Polygon being unavailable, with the bytes received', async () => {
      const failure = await download(() =>
        zipResponse(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(1024 * 1024));
              setTimeout(
                () =>
                  controller.error(
                    Object.assign(new Error('socket hang up'), {
                      code: 'ECONNRESET',
                    }),
                  ),
                20,
              );
            },
          }),
        ),
      );
      expect(failure).toMatchObject({
        code: 'polygon_unavailable',
        message: 'the download stopped after 1.0 MiB: ECONNRESET',
      });
    });

    it('gives up on a body that sends nothing for the idle time', async () => {
      const failure = await download(
        (_url, init) =>
          zipResponse(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new Uint8Array(10));
                init?.signal?.addEventListener('abort', () =>
                  controller.error(init.signal?.reason),
                );
              },
            }),
          ),
        50,
      );
      expect(failure).toMatchObject({
        code: 'polygon_unavailable',
        message: 'the download stopped after 0.0 MiB: timed out',
      });
    });
  });

  it('reads a FAILED envelope Polygon sends as text/html with HTTP 200 instead of saving it as the package', async () => {
    polygon.reply('problem.package', {
      failed: 'apiKey: Incorrect API key',
      status: 200,
      contentType: 'text/html;charset=UTF-8',
    });
    const destination = join(directory, 'package.zip');
    expect(
      await failureCode(
        client().downloadPackage({ problemId: 1, packageId: 1 }, destination, {
          maxBytes: 1024,
        }),
      ),
    ).toBe('polygon_unauthorized');
    expect(() => readFileSync(destination)).toThrow();
  });

  it('refuses a package larger than the cap, and a JSON failure instead of a zip', async () => {
    polygon.reply('problem.package', { zip: Buffer.alloc(2048) });
    const destination = join(directory, 'package.zip');
    expect(
      await failureCode(
        client().downloadPackage({ problemId: 1, packageId: 1 }, destination, {
          maxBytes: 1024,
        }),
      ),
    ).toBe('polygon_package_too_large');
    polygon.reply('problem.package', {
      failed: 'packageId: Package not found',
    });
    expect(
      await failureCode(
        client().downloadPackage({ problemId: 1, packageId: 1 }, destination, {
          maxBytes: 1024,
        }),
      ),
    ).toBe('polygon_failed');
  });
});
