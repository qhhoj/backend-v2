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
const MISSING = 'https://hackmd.io/_uploads/missing.png';

/** The network: GOOD is a PNG, everything else a 404. */
const fetchStub = jest.fn((url: string) =>
  Promise.resolve(
    url === GOOD
      ? new Response(PNG, { status: 200 })
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

  const insert = async (description: string) => {
    const id = newId();
    await test.raw(Problem.name).insertOne({
      _id: toUuid(id),
      code: `p${id.slice(0, 6)}`,
      description,
      descriptionHtml: '<p>old</p>',
      translations: [
        { language: 'en', description, descriptionHtml: '<p>old</p>' },
      ],
    });
    return id;
  };
  const stored = (id: string) =>
    test.raw(Problem.name).findOne({ _id: toUuid(id) });

  it('re-hosts hackmd images, re-renders, backs up, keeps failed and note links, and is idempotent', async () => {
    const text = `![a](${GOOD})\n![b](${MISSING})\n[note](https://hackmd.io/@x/note)\n<img src="${GOOD}">`;
    const id = await insert(text);
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
    expect(readFileSync(backup, 'utf8')).toContain(GOOD);
    const url = /!\[a\]\(([^)]+)\)/.exec(String(row?.description))![1];
    const path = url.slice(test.storage.publicUrl('').length);
    expect(readFileSync(test.storage.absolutePathOf(path))).toEqual(PNG);

    const second = await run(['--apply', '--backup', `${backup}.2`]);
    expect(second.planned).toBe(0);
  });

  it('never fetches a host that is not hackmd', async () => {
    const evil = jest.fn(() =>
      Promise.resolve(new Response(PNG)),
    ) as unknown as typeof fetch;
    const guarded = await setupContentJobsTest(evil);
    try {
      await guarded.raw(Problem.name).insertOne({
        _id: toUuid(newId()),
        code: 'evil',
        description:
          '![x](https://169.254.169.254/a.png)\n![y](https://evilhackmd.io/a.png)',
      });
      const report = await runContentJob(
        guarded.module.get(RehostHackmdImagesJob),
        parseJobOptions([]),
        guarded.storage,
      );
      expect(report.planned).toBe(0);
      expect(evil).not.toHaveBeenCalled();
    } finally {
      await guarded.teardown();
    }
  });
});
