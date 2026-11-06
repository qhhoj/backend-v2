import { getModelToken } from '@nestjs/mongoose';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type Redis from 'ioredis';
import type { Model } from 'mongoose';
import { REDIS } from '@libs/common';
import { OrganizationCreditEntry, OrganizationUsage } from '@libs/database';
import { buildZip } from '@libs/problems/testing';
import { QUOTA_BACKFILL_DONE_KEY } from '../src/modules/organizations/quota/quota.constants';
import { CHUNK_BYTES } from '../src/modules/problems/data/chunked/chunked-upload.limits';
import { createOrganization } from './organization-fixtures';
import {
  authed,
  createProblem,
  createUserWith,
  loginAs,
  seedCatalog,
} from './problem-fixtures';
import type { Catalog, TestSession } from './problem-fixtures';
import { errorCode, issueCodes, setupApiTest } from './setup';
import type { ApiTest } from './setup';

const PROBLEMS = '/api/internal/problems';
const sha256Of = (content: Buffer) =>
  createHash('sha256').update(content).digest('hex');
const smallZip = buildZip([
  { name: '1.in', content: 'in' },
  { name: '1.out', content: 'out' },
]);
interface Session {
  id: string;
  chunkBytes: number;
  chunkCount: number;
  received: number[];
}
const sessionOf = ({ body }: { body: unknown }) =>
  (body as { data: Session }).data;

let api: ApiTest;
let catalog: Catalog;
let editor: TestSession;
let coEditor: TestSession;
let editorIds: string[] = [];
let counter = 0;
beforeAll(async () => {
  api = await setupApiTest();
  catalog = await seedCatalog(api);
  const permissions = [
    'judge.edit_own_problem',
    'judge.create_organization_problem',
  ];
  const editorId = (await createUserWith(api, 'chunkeditor', { permissions }))
    ._id;
  const coEditorId = (
    await createUserWith(api, 'chunkcoeditor', { permissions })
  )._id;
  editor = await loginAs(api, editorId);
  coEditor = await loginAs(api, coEditorId);
  await api.setSetting('quota.enforce', 'enforce');
  await api.app.get<Redis>(REDIS).set(QUOTA_BACKFILL_DONE_KEY, '1');
  editorIds = [editorId, coEditorId];
});
afterAll(() => api.teardown());

/** A public problem (no quota) or one of a new organization (charged). */
async function newProblem(inOrganization = false) {
  counter += 1;
  const organization = inOrganization ? await createOrganization(api) : null;
  const problem = await createProblem(api, catalog, {
    code: `chunk${counter}`,
    authors: editorIds,
    ...(organization && {
      isPublic: false,
      isOrganizationPrivate: true,
      organizations: [organization._id],
    }),
  });
  return { code: problem.code, organizationId: organization?._id ?? null };
}

const uploadsOf = (code: string) => `${PROBLEMS}/${code}/data/uploads`;
const create = (
  code: string,
  content: Buffer,
  session = editor,
  sha256 = sha256Of(content),
) =>
  authed(api.http().post(uploadsOf(code)), session).send({
    name: 'big tests.zip',
    size: content.length,
    sha256,
  });
const putChunk = (
  code: string,
  target: { id: string; index: number },
  bytes: Buffer,
  session = editor,
) =>
  authed(
    api.http().put(`${uploadsOf(code)}/${target.id}/chunks/${target.index}`),
    session,
  ).attach('file', bytes, {
    filename: 'chunk',
    contentType: 'application/octet-stream',
  });
const chunkOf = (content: Buffer, index: number) =>
  content.subarray(index * CHUNK_BYTES, (index + 1) * CHUNK_BYTES);
const complete = (code: string, id: string, session = editor) =>
  authed(api.http().post(`${uploadsOf(code)}/${id}/complete`), session);
const status = (code: string, id: string, session = editor) =>
  authed(api.http().get(`${uploadsOf(code)}/${id}`), session);
const partsDirectory = (id: string) =>
  join(api.problemDataRoot, '.uploads', id);
const filesOf = (code: string) =>
  readdirSync(join(api.problemDataRoot, code)).sort();

describe('chunked data upload', () => {
  it('resumes after a missing chunk and stores the archive exactly like a single upload', async () => {
    const content = buildZip([
      { name: '1.in', content: Buffer.alloc(CHUNK_BYTES, 'x') },
      { name: '1.out', content: 'out' },
    ]);
    const chunked = await newProblem();
    const session = sessionOf(await create(chunked.code, content).expect(201));
    expect(session).toMatchObject({ chunkBytes: CHUNK_BYTES, chunkCount: 2 });
    await putChunk(
      chunked.code,
      { id: session.id, index: 0 },
      chunkOf(content, 0),
    ).expect(200);
    await complete(chunked.code, session.id)
      .expect(409)
      .expect(issueCodes(['chunks_missing']));
    expect(
      sessionOf(await status(chunked.code, session.id).expect(200)).received,
    ).toEqual([0]);
    await putChunk(
      chunked.code,
      { id: session.id, index: 1 },
      chunkOf(content, 1),
    ).expect(200);
    const viaChunks = await complete(chunked.code, session.id).expect(201);

    const single = await newProblem();
    const viaSingle = await authed(
      api.http().post(`${PROBLEMS}/${single.code}/data/archive`),
      editor,
    )
      .attach('file', content, { filename: 'big tests.zip' })
      .expect(201);
    expect(viaChunks.body).toEqual(viaSingle.body);
    expect(filesOf(chunked.code)).toEqual(filesOf(single.code));
    expect(
      sha256Of(
        readFileSync(join(api.problemDataRoot, chunked.code, 'big_tests.zip')),
      ),
    ).toBe(sha256Of(content));
    expect(existsSync(partsDirectory(session.id))).toBe(false);
  });

  describe('quota', () => {
    let usage: Model<OrganizationUsage>;
    let ledger: Model<OrganizationCreditEntry>;
    beforeAll(() => {
      usage = api.app.get(getModelToken(OrganizationUsage.name));
      ledger = api.app.get(getModelToken(OrganizationCreditEntry.name));
    });
    const creditsOf = async (organizationId: string) =>
      (await usage.findOne({ organization: organizationId }).lean())
        ?.creditsUsed ?? 0;
    const ledgerOf = async (organizationId: string) =>
      (await ledger.find({ organization: organizationId }).lean()).map(
        ({ reason, amount }) => [reason, amount],
      );

    it('refuses a wrong hash before anything is staged or charged, and ends the session', async () => {
      const { code, organizationId } = await newProblem(true);
      const session = sessionOf(
        await create(
          code,
          smallZip,
          editor,
          sha256Of(Buffer.from('other')),
        ).expect(201),
      );
      await putChunk(code, { id: session.id, index: 0 }, smallZip).expect(200);
      await complete(code, session.id)
        .expect(400)
        .expect(issueCodes(['upload_hash_mismatch']));
      expect(await creditsOf(organizationId!)).toBe(0);
      expect(await ledgerOf(organizationId!)).toEqual([]);
      expect(filesOf(code)).toEqual([]);
      expect(existsSync(partsDirectory(session.id))).toBe(false);
      await status(code, session.id).expect(404);
    });

    it('sweeps the chunks of an expired session with nothing charged, and charges a completed one once', async () => {
      const { code, organizationId } = await newProblem(true);
      const expired = sessionOf(await create(code, smallZip).expect(201));
      await putChunk(code, { id: expired.id, index: 0 }, smallZip).expect(200);
      await api.app
        .get<Redis>(REDIS)
        .pexpire(`chunked-upload:${expired.id}`, 1);
      await new Promise((resolve) => setTimeout(resolve, 20));
      const next = sessionOf(await create(code, smallZip).expect(201));
      expect(existsSync(partsDirectory(expired.id))).toBe(false);
      await status(code, expired.id).expect(404);
      expect(await ledgerOf(organizationId!)).toEqual([]);

      await putChunk(code, { id: next.id, index: 0 }, smallZip).expect(200);
      const stored = await complete(code, next.id).expect(201);
      const repeated = await complete(code, next.id).expect(201);
      expect(repeated.body).toEqual(stored.body);
      expect(await creditsOf(organizationId!)).toBe(1);
      expect(await ledgerOf(organizationId!)).toEqual([['upload', 1]]);
    });
  });

  it("refuses another user's session, even an editor of the same problem", async () => {
    const { code } = await newProblem();
    const session = sessionOf(await create(code, smallZip).expect(201));
    const target = { id: session.id, index: 0 };
    await status(code, session.id, coEditor)
      .expect(404)
      .expect(errorCode('not_found'));
    await putChunk(code, target, smallZip, coEditor).expect(404);
    await complete(code, session.id, coEditor).expect(404);
    await authed(
      api.http().delete(`${uploadsOf(code)}/${session.id}`),
      coEditor,
    ).expect(404);
    await putChunk(code, target, smallZip).expect(200);
    await authed(
      api.http().delete(`${uploadsOf(code)}/${session.id}`),
      editor,
    ).expect(204);
    expect(existsSync(partsDirectory(session.id))).toBe(false);
  });

  it('refuses a chunk outside the session or of the wrong length, and a third open session', async () => {
    const { code } = await newProblem();
    const session = sessionOf(
      await create(code, smallZip, coEditor).expect(201),
    );
    await putChunk(code, { id: session.id, index: 1 }, smallZip, coEditor)
      .expect(400)
      .expect(issueCodes(['chunk_index_out_of_range']));
    await putChunk(
      code,
      { id: session.id, index: 0 },
      smallZip.subarray(1),
      coEditor,
    )
      .expect(400)
      .expect(issueCodes(['chunk_size_mismatch']));
    await putChunk(
      code,
      { id: session.id, index: 0 },
      Buffer.concat([smallZip, Buffer.from('x')]),
      coEditor,
    ).expect(413);
    expect(
      sessionOf(await status(code, session.id, coEditor)).received,
    ).toEqual([]);
    await create(code, smallZip, coEditor).expect(201);
    await create(code, smallZip, coEditor)
      .expect(409)
      .expect(issueCodes(['upload_sessions_full']));
  });
});
