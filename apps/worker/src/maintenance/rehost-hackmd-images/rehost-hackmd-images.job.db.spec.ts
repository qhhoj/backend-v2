import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newId, Problem, toUuid } from '@libs/database';
import { setupContentJobsTest } from '../../../test/content-jobs-setup';
import type { ContentJobsTest } from '../../../test/content-jobs-setup';
import { parseJobOptions } from '../job-options';
import { runContentJob } from '../run-content-job';
import { RehostHackmdImagesJob } from './rehost-hackmd-images.job';

const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000001e221bc330000000049454e44ae426082',
  'hex',
);
const GOOD = 'https://hackmd.io/_uploads/good.png';
const VIA_BUCKET = 'https://hackmd.io/_uploads/via-bucket.png';
const BUCKET_URL =
  'https://hackmd-prod-images.s3-ap-northeast-1.amazonaws.com/uploads/good.png';
const MISSING = 'https://hackmd.io/_uploads/missing.png';

/** The network: GOOD is a PNG, everything else a 404. */
const fetchStub = jest.fn((url: string) =>
  Promise.resolve(
    url === GOOD
      ? new Response(PNG, { status: 200 })
      : url === VIA_BUCKET
        ? new Response(null, { status: 302, headers: { location: BUCKET_URL } })
        : url === BUCKET_URL
          ? new Response(PNG, {
              status: 200,
              headers: { 'content-type': 'image/png' },
            })
          : new Response('no', { status: 404 }),
  ),
) as unknown as typeof fetch;

describe('rehost-hackmd-images job', () => {
  let test: ContentJobsTest;
  let job: RehostHackmdImagesJob;
  const run = (args: string[]) =>
    runContentJob(job, parseJobOptions(args), test.storage);

  beforeAll(async () => {
    test = await setupContentJobsTest(fetchStub);
    job = test.module.get(RehostHackmdImagesJob);
  });
  afterAll(() => test.teardown());

  const insert = async (description: string, html = '<p>old</p>') => {
    const id = newId();
    await test.raw(Problem.name).insertOne({
      _id: toUuid(id),
      code: `p${id.slice(0, 6)}`,
      description,
      descriptionHtml: html,
      translations: [{ language: 'en', description, descriptionHtml: html }],
    });
    return id;
  };
  const stored = (id: string) =>
    test.raw(Problem.name).findOne({ _id: toUuid(id) });

  it('re-hosts hackmd images, re-renders, backs up, keeps failed and note links, and is idempotent', async () => {
    const text = `![a](${GOOD})\n![b](${MISSING})\n[note](https://hackmd.io/@x/note)\n<img src="${GOOD}">`;
    const id = await insert(text, `<p><img src="${GOOD}"></p>`);
    const plain = await insert('no images here, see hackmd.io');

    const dry = await run([]);
    expect(dry.planned).toBe(1);
    expect(dry.skipped['image kept (http 404)']).toBeGreaterThan(0);
    expect((await stored(id))?.description).toBe(text);
    expect(existsSync(join(test.mediaRoot, 'images'))).toBe(false);

    const backup = join(tmpdir(), `qhhoj-backup-${newId()}.jsonl`);
    expect((await run(['--apply', '--backup', backup])).written).toBe(1);
    const row = await stored(id);
    const ours = test.storage.publicUrl('images/hackmd-');
    expect(row?.description).toContain(`![a](${ours}`);
    expect(row?.description).toContain(`![b](${MISSING})`);
    expect(row?.description).toContain('[note](https://hackmd.io/@x/note)');
    expect(row?.descriptionHtml).toContain(ours);
    const translation = (row?.translations as Record<string, string>[])[0];
    expect(translation.description).toBe(row?.description);
    expect(translation.descriptionHtml).toBe(row?.descriptionHtml);
    expect((await stored(plain))?.description).toBe(
      'no images here, see hackmd.io',
    );
    const backedUp = JSON.parse(readFileSync(backup, 'utf8').split('\n')[0]);
    expect(backedUp.before.description).toBe(text);
    expect(backedUp.after.description).toBe(row?.description);
    const url = /!\[a\]\(([^)]+)\)/.exec(String(row?.description))![1];
    const path = url.slice(test.storage.publicUrl('').length);
    expect(readFileSync(test.storage.absolutePathOf(path))).toEqual(PNG);

    const second = await run(['--apply', '--backup', `${backup}.2`]);
    expect(second.planned).toBe(0);
  });

  it('rewrites only the image URL: raw HTML of a full-markup statement stays byte for byte', async () => {
    const html =
      `<table style="border:1px solid red"><tr><td>x &amp; y</td></tr></table>\n` +
      `<div style="color:#f00" onclick="k()">\n  <img src="${GOOD}" width="40">\n</div>`;
    const text = `<div style="color:#f00" onclick="k()"><img src="${GOOD}"></div>`;
    const id = await insert(text, html);
    const apply = await run([
      '--apply',
      '--backup',
      join(tmpdir(), `qhhoj-backup-${newId()}.jsonl`),
    ]);
    expect(apply.written).toBeGreaterThanOrEqual(1);
    const ours = test.storage.publicUrl(
      /images\/hackmd-[0-9a-f]+\.png/.exec(
        String((await stored(id))?.descriptionHtml),
      )![0],
    );
    expect((await stored(id))?.descriptionHtml).toBe(html.replace(GOOD, ours));
    expect((await stored(id))?.description).toBe(text.replace(GOOD, ours));
  });

  it('follows a redirect from hackmd to its uploads bucket, but never starts there', async () => {
    const id = await insert(
      `![v](${VIA_BUCKET})`,
      `<p><img src="${VIA_BUCKET}"></p>`,
    );
    const direct = await insert(`![d](${BUCKET_URL}) hackmd.io`);
    await run([
      '--apply',
      '--backup',
      join(tmpdir(), `qhhoj-backup-${newId()}.jsonl`),
    ]);
    expect((await stored(id))?.description).toContain(
      test.storage.publicUrl('images/hackmd-'),
    );
    expect((await stored(direct))?.description).toBe(
      `![d](${BUCKET_URL}) hackmd.io`,
    );
  });

  it('never fetches a host that is not hackmd, also after a redirect', async () => {
    const REDIRECTED = 'https://hackmd.io/_uploads/redirected.png';
    const evil = jest.fn((url: string) =>
      Promise.resolve(
        url === REDIRECTED
          ? new Response(null, {
              status: 302,
              headers: { location: 'https://127.0.0.1/a.png' },
            })
          : new Response(PNG),
      ),
    ) as unknown as typeof fetch;
    const guarded = await setupContentJobsTest(evil);
    try {
      await guarded.raw(Problem.name).insertOne({
        _id: toUuid(newId()),
        code: 'evil',
        description: `![x](https://169.254.169.254/a.png)\n![y](https://evilhackmd.io/a.png)\n![z](${REDIRECTED})`,
      });
      const report = await runContentJob(
        guarded.module.get(RehostHackmdImagesJob),
        parseJobOptions([]),
        guarded.storage,
      );
      expect(report.planned).toBe(0);
      expect(evil).toHaveBeenCalledTimes(1);
      expect(evil).toHaveBeenCalledWith(REDIRECTED, expect.anything());
    } finally {
      await guarded.teardown();
    }
  });
});
