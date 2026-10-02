import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp } from '@libs/common/testing';
import request from 'supertest';
import { HealthController } from '../src/health.controller';

describe('GET /healthz', () => {
  let app: NestFastifyApplication;
  beforeAll(async () => {
    app = await createTestApp({ controllers: [HealthController] });
  });
  afterAll(() => app.close());

  it('returns ok', () =>
    request(app.getHttpServer())
      .get('/healthz')
      .expect(200, { data: { status: 'ok' } }));
});
