import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { configureApp, fastifyAdapter } from '@libs/common/bootstrap';
import request from 'supertest';
import { HealthController } from '../src/health.controller';

describe('GET /healthz', () => {
  let app: NestFastifyApplication;
  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile();
    app = mod.createNestApplication<NestFastifyApplication>(fastifyAdapter());
    configureApp(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });
  afterAll(() => app.close());

  it('returns ok', () =>
    request(app.getHttpServer()).get('/healthz').expect(200, { status: 'ok' }));
});
