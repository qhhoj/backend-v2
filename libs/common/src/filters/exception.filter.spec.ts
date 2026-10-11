import {
  ArgumentsHost,
  ForbiddenException,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { AppError } from '../errors/app.error';
import { AppExceptionFilter } from './exception.filter';

interface Sent {
  status: number;
  headers: Record<string, string>;
  body: { error: Record<string, unknown> };
}

const run = (exception: unknown): Sent => {
  const sent = { status: 0, headers: {}, body: undefined } as unknown as Sent;
  const reply = {
    status(code: number) {
      sent.status = code;
      return reply;
    },
    headers(values: Record<string, string>) {
      sent.headers = values;
      return reply;
    },
    send(body: Sent['body']) {
      sent.body = body;
    },
  };
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ id: 'r1' }),
      getResponse: () => reply,
    }),
  } as unknown as ArgumentsHost;
  new AppExceptionFilter().catch(exception, host);
  return sent;
};

describe('AppExceptionFilter issues', () => {
  it('names a 401 refusal "unauthenticated" while keeping its error code', () => {
    const { status, body } = run(
      new AppError('unauthorized', 401, 'Login required'),
    );
    expect(status).toBe(401);
    expect(body.error).toEqual({
      code: 'unauthorized',
      message: 'Login required',
      issues: [
        { field: '', code: 'unauthenticated', message: 'Login required' },
      ],
    });
  });

  it('keeps Retry-After next to the issue of a 429', () => {
    const { status, headers, body } = run(
      new AppError('rate_limited', 429, 'Slow down', undefined, {
        'Retry-After': '7',
      }),
    );
    expect(status).toBe(429);
    expect(headers['Retry-After']).toBe('7');
    expect(body.error.issues).toEqual([
      { field: '', code: 'rate_limited', message: 'Slow down' },
    ]);
  });

  it('keeps issues the error already carries, and the extra members', () => {
    const issues = [{ field: 'balloons', code: 'x', message: 'm' }];
    const { body } = run(
      new AppError('c', 409, 'm', undefined, undefined, { issues, hint: 'h' }),
    );
    expect(body.error.issues).toEqual(issues);
    expect(body.error.hint).toBe('h');
  });

  it('keeps issues derived from fields', () => {
    const { body } = run(
      new AppError('validation_failed', 400, 'x', { a: ['m'] }),
    );
    expect(body.error.issues).toEqual([
      { field: 'a', code: 'invalid', message: 'm' },
    ]);
    expect(body.error.fields).toEqual({ a: ['m'] });
  });

  it('gives framework 403 and 404 exceptions issues coded after their error code', () => {
    expect(run(new ForbiddenException('No')).body.error.issues).toEqual([
      { field: '', code: 'forbidden', message: 'No' },
    ]);
    expect(run(new NotFoundException('Gone')).body.error).toMatchObject({
      code: 'not_found',
      issues: [{ field: '', code: 'not_found', message: 'Gone' }],
    });
  });

  it("names Fastify's body-limit refusal payload_too_large, with an issue of the same code", () => {
    const { status, body } = run(
      new PayloadTooLargeException('Request body is too large'),
    );
    expect(status).toBe(413);
    expect(body.error).toEqual({
      code: 'payload_too_large',
      message: 'Request body is too large',
      issues: [
        {
          field: '',
          code: 'payload_too_large',
          message: 'Request body is too large',
        },
      ],
    });
  });

  it('adds no issues to a 500', () => {
    const { status, body } = run(new Error('boom'));
    expect(status).toBe(500);
    expect(body.error.issues).toBeUndefined();
  });
});
