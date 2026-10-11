import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

  it('reports an HTTP error page or a network failure as unavailable', async () => {
    polygon.reply('problems.list', { status: 503 });
    expect(await failureCode(client().problems())).toBe('polygon_unavailable');
    const offline = new PolygonClient(fakeSettings(CONNECTED), () =>
      Promise.reject(new TypeError('fetch failed')),
    );
    expect(await failureCode(offline.problems())).toBe('polygon_unavailable');
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
