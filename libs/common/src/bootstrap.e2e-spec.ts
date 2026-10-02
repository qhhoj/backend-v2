import { Controller, Get, Ip, Req } from '@nestjs/common';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { FastifyRequest } from 'fastify';
import request from 'supertest';
import { configureApp, fastifyAdapter } from './bootstrap';

@Controller('probe')
class ProbeController {
  @Get() probe(@Ip() ip: string, @Req() incoming: FastifyRequest) {
    return { ip, requestId: incoming.id };
  }
}

const start = async (trustProxy: boolean) => {
  const app = (
    await Test.createTestingModule({ controllers: [ProbeController] }).compile()
  ).createNestApplication<NestFastifyApplication>(
    fastifyAdapter({ trustProxy }),
  );
  await configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
};

describe.each([false, true])('trustProxy=%s', (trustProxy) => {
  let app: NestFastifyApplication;
  beforeAll(async () => {
    app = await start(trustProxy);
  });
  afterAll(() => app.close());

  it(`${trustProxy ? 'trusts' : 'ignores'} client-supplied forwarding headers`, async () => {
    const { body } = (await request(app.getHttpServer())
      .get('/probe')
      .set('x-forwarded-for', '203.0.113.9')
      .set('x-request-id', 'client-id')) as {
      body: { data: { ip: string; requestId: string } };
    };
    expect(body.data.ip === '203.0.113.9').toBe(trustProxy);
    expect(body.data.requestId === 'client-id').toBe(trustProxy);
  });
});
