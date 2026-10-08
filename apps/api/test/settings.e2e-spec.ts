import { getModelToken } from '@nestjs/mongoose';
import { SettingsService } from '@libs/settings';
import { Setting, SettingRevision } from '@libs/database';
import type { Model } from 'mongoose';
import { v7 } from 'uuid';
import { authed, createUserWith, loginAs } from './problem-fixtures';
import type { TestSession } from './problem-fixtures';
import { dataOf } from './submission-fixtures';
import { errorCode, setupApiTest } from './setup';
import type { ApiTest } from './setup';

const SETTINGS = '/api/internal/admin/settings';
const SMTP = 'smtp://mailer:s3cret-pass@mail.test:587';

interface SettingView {
  key: string;
  value: unknown;
  default: unknown;
  isDefault: boolean;
  hasSecret: boolean;
}

describe('/api/internal/admin/settings', () => {
  let api: ApiTest;
  let admin: TestSession;
  let superuser: TestSession;
  let member: TestSession;
  const patch = (key: string, value: unknown, session = admin) =>
    authed(api.http().patch(`${SETTINGS}/${key}`), session).send({ value });
  const restore = (key: string, revisionId: string, session = admin) =>
    authed(
      api.http().post(`${SETTINGS}/${key}/revisions/${revisionId}/restore`),
      session,
    );
  const revisionsOf = (key: string) =>
    authed(api.http().get(`${SETTINGS}/${key}/revisions`), admin).expect(200);
  const newestRevisionId = async (key: string) =>
    dataOf<Array<{ id: string }>>(await revisionsOf(key))[0].id;
  const revisionTotal = async (key: string) =>
    ((await revisionsOf(key)).body as { meta: { total: number } }).meta.total;
  const list = async () =>
    dataOf<SettingView[]>(
      await authed(api.http().get(SETTINGS), admin).expect(200),
    );

  beforeAll(async () => {
    api = await setupApiTest();
    admin = await loginAs(
      api,
      (
        await createUserWith(api, 'ops', {
          permissions: ['judge.change_settings'],
        })
      )._id,
    );
    superuser = await loginAs(
      api,
      (await createUserWith(api, 'root', { isSuperuser: true }))._id,
    );
    member = await loginAs(api, (await createUserWith(api, 'member'))._id);
  });
  afterAll(() => api.teardown());

  it('is for judge.change_settings holders and superusers only', async () => {
    await api.http().get(SETTINGS).expect(401);
    await api
      .http()
      .patch(`${SETTINGS}/mail.from`)
      .send({ value: 'a@b.test' })
      .expect(401);
    await authed(api.http().get(SETTINGS), member)
      .expect(403)
      .expect(errorCode('forbidden'));
    await patch('mail.from', 'a@b.test', member).expect(403);
    await authed(
      api.http().get(`${SETTINGS}/mail.from/revisions`),
      member,
    ).expect(403);
    await authed(api.http().get(SETTINGS), superuser).expect(200);
    await authed(api.http().get(SETTINGS), admin).expect(200);
  });

  it('lists every registered setting with its default', async () => {
    const settings = await list();
    expect(settings.map((setting) => setting.key)).toEqual(
      expect.arrayContaining([
        'contest.officialMode',
        'contest.banAfterDisqualifications',
        'discord.webhooks',
        'mail.from',
        'mail.smtpUrl',
        'auth.pwnedApiUrl',
        'auth.google',
        'auth.github',
        'auth.facebook',
        'pdf.renderTimeoutMs',
        'pdf.maxBytes',
        'similarity.minPercent',
        'similarity.maxPairs',
        'similarity.maxSubmissions',
      ]),
    );
    expect(
      settings.find((setting) => setting.key === 'contest.officialMode'),
    ).toMatchObject({ value: false, isDefault: true, hasSecret: false });
  });

  it('ignores a stored row whose key left the registry', async () => {
    const rows = api.app.get<Model<Setting>>(getModelToken(Setting.name));
    await rows.collection.insertOne({
      _id: 'retired.key' as never,
      value: 'x',
      updatedAt: new Date(),
      updatedBy: null,
    });
    const keys = (await list()).map((setting) => setting.key);
    expect(keys).not.toContain('retired.key');
    expect([
      ...(await api.app.get(SettingsService).rows()).keys(),
    ]).not.toContain('retired.key');
    await rows.collection.deleteOne({ _id: 'retired.key' as never });
  });

  it('validates a patch and refuses null', async () => {
    const response = await patch('pdf.maxBytes', -1).expect(400);
    errorCode('validation_failed')(response);
    expect(
      (response.body as { error: { fields: object } }).error.fields,
    ).toHaveProperty('value');
    await patch('mail.from', null)
      .expect(400)
      .expect(errorCode('validation_failed'));
    await patch('contest.officialMode', 'yes').expect(400);
    await authed(api.http().patch(`${SETTINGS}/no.such.key`), admin)
      .send({ value: 1 })
      .expect(404)
      .expect(errorCode('not_found'));
  });

  it('applies a patch to readers at once and is default again once patched back', async () => {
    const view = dataOf<SettingView>(
      await patch('contest.banAfterDisqualifications', 2).expect(200),
    );
    expect(view).toMatchObject({ value: 2, isDefault: false });
    expect(
      api.app.get(SettingsService).get('contest.banAfterDisqualifications'),
    ).toBe(2);
    const reverted = dataOf<SettingView>(
      await patch('contest.banAfterDisqualifications', 0).expect(200),
    );
    expect(reverted).toMatchObject({ value: 0, isDefault: true });
  });

  it('merges social login fields and never returns or stores a secret in clear', async () => {
    await patch('auth.google', {
      enabled: true,
      clientId: 'cid',
      clientSecret: 'google-secret-1',
    }).expect(200);
    await patch('mail.smtpUrl', SMTP).expect(200);
    await patch('discord.webhooks', {
      default: 'https://discord.test/api/webhooks/tok-123',
    }).expect(200);
    // the UI patches without the secret it cannot see: the stored one survives
    const merged = dataOf<SettingView>(
      await patch('auth.google', { clientId: 'cid-2' }).expect(200),
    );
    expect(merged.value).toEqual({
      enabled: true,
      clientId: 'cid-2',
      clientSecret: { set: true },
    });
    expect(api.app.get(SettingsService).get('auth.google').clientSecret).toBe(
      'google-secret-1',
    );

    const listed = JSON.stringify(await list());
    expect(listed).not.toMatch(/google-secret-1|s3cret-pass|tok-123/);
    const smtp = (await list()).find(
      (setting) => setting.key === 'mail.smtpUrl',
    )!;
    expect(smtp).toMatchObject({ value: { set: true }, hasSecret: true });

    const stored = JSON.stringify(
      await api.app
        .get<Model<Setting>>(getModelToken(Setting.name))
        .find()
        .lean(),
    );
    expect(stored).not.toMatch(/google-secret-1|s3cret-pass|tok-123/);
    const revisions = JSON.stringify(
      await api.app
        .get<Model<SettingRevision>>(getModelToken(SettingRevision.name))
        .find()
        .lean(),
    );
    expect(revisions).not.toMatch(/google-secret-1|s3cret-pass|tok-123/);

    const error = JSON.stringify(
      (
        await patch('discord.webhooks', {
          default: 'http://secret.example/tok-999',
        }).expect(400)
      ).body,
    );
    expect(error).not.toMatch(/secret\.example|tok-999/);
  });

  it('lists revisions with who changed what', async () => {
    const response = await authed(
      api
        .http()
        .get(`${SETTINGS}/auth.google/revisions`)
        .query({ pageSize: 10 }),
      admin,
    ).expect(200);
    const body = response.body as {
      data: Array<{ changedFields: string[]; actor: string | null }>;
      meta: { total: number };
    };
    expect(body.meta.total).toBe(2);
    expect(body.data[0].changedFields).toEqual(['clientId']);
    expect(body.data[0].actor).not.toBeNull();
  });

  it('answers every setting with its default, a secret default redacted', async () => {
    const settings = await list();
    for (const setting of settings) expect(setting).toHaveProperty('default');
    const google = settings.find((setting) => setting.key === 'auth.google')!;
    expect(google.default).toMatchObject({ clientSecret: { set: false } });
    const smtp = settings.find((setting) => setting.key === 'mail.smtpUrl')!;
    expect(smtp.default).toEqual({ set: false });
    expect(
      settings.find((setting) => setting.key === 'pdf.renderTimeoutMs'),
    ).toMatchObject({ default: 30_000 });
    expect(JSON.stringify(settings)).not.toMatch(
      /google-secret-1|s3cret-pass|tok-123/,
    );
  });

  it('restores a revision: the value is back, the restore is a new revision and the querier sees it', async () => {
    await patch('pdf.renderTimeoutMs', 45_000).expect(200);
    const revisionsBefore = await revisionTotal('pdf.renderTimeoutMs');
    const restored = dataOf<SettingView>(
      await restore(
        'pdf.renderTimeoutMs',
        await newestRevisionId('pdf.renderTimeoutMs'),
      ).expect(200),
    );
    expect(restored).toMatchObject({
      value: 30_000,
      default: 30_000,
      isDefault: true,
    });
    expect(api.app.get(SettingsService).get('pdf.renderTimeoutMs')).toBe(
      30_000,
    );
    expect(await revisionTotal('pdf.renderTimeoutMs')).toBe(
      revisionsBefore + 1,
    );
  });

  it('restores an object setting and keeps its stored secret', async () => {
    await patch('auth.github', {
      enabled: true,
      clientId: 'gh-1',
      clientSecret: 'gh-secret-1',
    }).expect(200);
    await patch('auth.github', { clientId: 'gh-2' }).expect(200);
    const restored = dataOf<SettingView>(
      await restore(
        'auth.github',
        await newestRevisionId('auth.github'),
      ).expect(200),
    );
    expect(restored.value).toEqual({
      enabled: true,
      clientId: 'gh-1',
      clientSecret: { set: true },
    });
    expect(api.app.get(SettingsService).get('auth.github')).toMatchObject({
      clientId: 'gh-1',
      clientSecret: 'gh-secret-1',
    });
    expect(JSON.stringify(await list())).not.toContain('gh-secret-1');
  });

  it('refuses to restore a whole-secret setting with 409', async () => {
    for (const key of ['mail.smtpUrl', 'discord.webhooks']) {
      const response = await restore(key, await newestRevisionId(key)).expect(
        409,
      );
      errorCode('secret_unrestorable')(response);
    }
    expect(api.app.get(SettingsService).get('mail.smtpUrl')).toBe(SMTP);
  });

  it('answers 404 for an unknown key, an unknown revision and a revision of another key', async () => {
    await restore('no.such.key', await newestRevisionId('pdf.renderTimeoutMs'))
      .expect(404)
      .expect(errorCode('not_found'));
    await restore('pdf.renderTimeoutMs', v7())
      .expect(404)
      .expect(errorCode('not_found'));
    await restore('auth.google', await newestRevisionId('pdf.renderTimeoutMs'))
      .expect(404)
      .expect(errorCode('not_found'));
  });

  it('is for judge.change_settings holders only', async () => {
    const revisionId = await newestRevisionId('pdf.renderTimeoutMs');
    await api
      .http()
      .post(`${SETTINGS}/pdf.renderTimeoutMs/revisions/${revisionId}/restore`)
      .expect(401);
    await restore('pdf.renderTimeoutMs', revisionId, member)
      .expect(403)
      .expect(errorCode('forbidden'));
  });
});
