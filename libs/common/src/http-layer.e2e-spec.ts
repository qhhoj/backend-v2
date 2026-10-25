import {
  Body,
  Controller,
  Get,
  Header,
  Post,
  StreamableFile,
} from '@nestjs/common';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { IsInt, IsString } from 'class-validator';
import request from 'supertest';
import {
  AppError,
  Paginated,
  RawResponse,
  ValidationFailedError,
} from './index';
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
  @Get('app-error-extra') appErrorExtra() {
    throw new AppError('conflict', 409, 'x', undefined, undefined, {
      hint: 'y',
      code: 'hacked',
    });
  }
  @Get('issues') issues() {
    throw new ValidationFailedError('Bad', [
      { field: 'a', code: 'too_big', message: 'Too big.' },
    ]);
  }
  @Get('plain-fields') plainFields() {
    throw new AppError('validation_failed', 400, 'x', { a: ['m'] });
  }
  @Get('crash') crash() {
    throw new Error('boom');
  }
  @Post('echo') echo(@Body() dto: EchoDto) {
    return dto;
  }
}

@Controller('api/t')
class ApiCacheController {
  @Get('json') json() {
    return { a: 1 };
  }
  @Get('files/tests.zip') download() {
    return new StreamableFile(Buffer.from('zip'));
  }
  @Header('Cache-Control', 'private, max-age=15')
  @Get('counted')
  counted() {
    return { n: 1 };
  }
}

describe('http layer', () => {
  let app: NestFastifyApplication;
  const http = () => request(app.getHttpServer());
  beforeAll(async () => {
    app = await createTestApp({
      controllers: [TestController, ApiCacheController],
    });
  });
  afterAll(() => app.close());

  it('keeps /api answers out of shared caches', async () => {
    for (const path of ['/api/t/json', '/api/t/files/tests.zip'])
      await http()
        .get(path)
        .expect(200)
        .expect('cache-control', 'private, no-store');
    await http()
      .get('/t/obj')
      .expect((res) => {
        expect(res.headers['cache-control']).toBeUndefined();
      });
  });
  it('varies a private max-age answer by cookie', () =>
    http()
      .get('/api/t/counted')
      .expect(200)
      .expect('cache-control', 'private, max-age=15')
      .expect('vary', 'Cookie'));
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
      .expect(403, {
        error: {
          issues: [{ field: '', code: 'banned', message: 'Banned: spam' }],
          code: 'banned',
          message: 'Banned: spam',
        },
      }));
  it('merges extras next to code and message without overriding them', () =>
    http()
      .get('/t/app-error-extra')
      .expect(409, {
        error: {
          issues: [{ field: '', code: 'conflict', message: 'x' }],
          hint: 'y',
          code: 'conflict',
          message: 'x',
        },
      }));
  it('answers field issues next to the field messages', () =>
    http()
      .get('/t/issues')
      .expect(400, {
        error: {
          code: 'validation_failed',
          message: 'Bad',
          fields: { a: ['Too big.'] },
          issues: [{ field: 'a', code: 'too_big', message: 'Too big.' }],
        },
      }));
  it('derives issues with code invalid for a plain AppError with fields', () =>
    http()
      .get('/t/plain-fields')
      .expect(400, {
        error: {
          code: 'validation_failed',
          message: 'x',
          fields: { a: ['m'] },
          issues: [{ field: 'a', code: 'invalid', message: 'm' }],
        },
      }));
  it('hides internal errors', async () => {
    const { body } = (await http()
      .get('/t/crash')
      .set('x-request-id', 'req-1')
      .expect(500)) as { body: { error: { code: string; message: string } } };
    // Client-supplied request ids are ignored unless TRUST_PROXY is on.
    expect(body.error.code).toBe('internal_error');
    expect(body.error.message).toMatch(/^Request [0-9a-f-]{36} failed$/);
  });
  it('maps unknown routes', () =>
    http()
      .get('/nope')
      .expect(404)
      .expect((response) =>
        expect((response.body as ErrBody).error.code).toBe('not_found'),
      ));
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
