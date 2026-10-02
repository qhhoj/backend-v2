import { Body, Controller, Get, Post } from '@nestjs/common';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { IsInt, IsString } from 'class-validator';
import request from 'supertest';
import { AppError, Paginated, RawResponse } from './index';
import { createTestApp } from './testing';

type ErrBody = { error: { code: string; fields?: Record<string, string[]> } };

class EchoDto {
  @IsString() name!: string;
  @IsInt() age!: number;
}

@Controller('t')
class TestController {
  @Get('obj') obj() {
    return { a: 1 };
  }
  @Get('page') page() {
    return new Paginated([1, 2], { total: 2 });
  }
  @Get('raw') @RawResponse() raw() {
    return { legacy: true };
  }
  @Get('app-error') appError() {
    throw new AppError('banned', 403, 'Banned: spam');
  }
  @Get('crash') crash() {
    throw new Error('boom');
  }
  @Post('echo') echo(@Body() dto: EchoDto) {
    return dto;
  }
}

describe('http layer', () => {
  let app: NestFastifyApplication;
  const http = () => request(app.getHttpServer());
  beforeAll(async () => {
    app = await createTestApp({ controllers: [TestController] });
  });
  afterAll(() => app.close());

  it('wraps results', () =>
    http()
      .get('/t/obj')
      .expect(200, { data: { a: 1 } }));
  it('wraps pages', () =>
    http()
      .get('/t/page')
      .expect(200, { data: [1, 2], meta: { total: 2 } }));
  it('skips wrapping for raw', () =>
    http().get('/t/raw').expect(200, { legacy: true }));
  it('maps AppError', () =>
    http()
      .get('/t/app-error')
      .expect(403, { error: { code: 'banned', message: 'Banned: spam' } }));
  it('hides internal errors', async () => {
    const res = await http()
      .get('/t/crash')
      .set('x-request-id', 'req-1')
      .expect(500);
    expect(res.body).toEqual({
      error: { code: 'internal_error', message: 'Request req-1 failed' },
    });
  });
  it('maps unknown routes', () =>
    http()
      .get('/nope')
      .expect(404)
      .expect((r) => expect((r.body as ErrBody).error.code).toBe('not_found')));
  it('validates and strips', async () => {
    const bad = await http()
      .post('/t/echo')
      .send({ name: 1, age: 'x' })
      .expect(400);
    expect((bad.body as ErrBody).error.code).toBe('validation_failed');
    expect(
      Object.keys((bad.body as ErrBody).error.fields ?? {}).sort(),
    ).toEqual(['age', 'name']);
    await http()
      .post('/t/echo')
      .send({ name: 'a', age: 1, extra: 1 })
      .expect(400);
    await http()
      .post('/t/echo')
      .send({ name: 'a', age: 1 })
      .expect(201, { data: { name: 'a', age: 1 } });
  });
});
