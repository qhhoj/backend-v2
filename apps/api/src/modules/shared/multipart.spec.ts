import multipart from '@fastify/multipart';
import fastify, { type FastifyInstance } from 'fastify';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppError } from '@libs/common';
import { readMultipartForm, saveMultipartFile } from './multipart';

const BOUNDARY = 'xBOUNDARYx';
const MAX_BYTES = 8;
const FIELD_NAMES = ['language', 'judgeId'];

interface Part {
  name: string;
  value: string;
  filename?: string;
}
const body = (parts: Part[]) =>
  parts
    .map(
      ({ name, value, filename }) =>
        `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${name}"${
          filename === undefined ? '' : `; filename="${filename}"`
        }\r\n\r\n${value}\r\n`,
    )
    .join('') + `--${BOUNDARY}--\r\n`;
const file = (value: string, name = 'file'): Part => ({
  name,
  value,
  filename: 'a.txt',
});
const field = (name: string, value: string): Part => ({ name, value });

describe('multipart readers', () => {
  let app: FastifyInstance;
  let directory: string;
  let targetPath: string;

  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), 'qhhoj-multipart-'));
    app = fastify();
    await app.register(multipart);
    app.addContentTypeParser('text/plain', (_request, _payload, done) =>
      done(null),
    );
    app.setErrorHandler((error: Error, _request, reply) => {
      const status = error instanceof AppError ? error.status : 500;
      void reply.status(status).send({
        code: (error as { code?: string }).code,
        message: error.message,
      });
    });
    app.post('/form', async (request) => {
      const { filename, content, fields } = await readMultipartForm(
        request,
        MAX_BYTES,
        FIELD_NAMES,
      );
      return { filename, content: content.toString(), fields };
    });
    app.post('/save', async (request) =>
      saveMultipartFile(request, MAX_BYTES, targetPath, (filename) => {
        if (filename !== 'a.txt') throw new AppError('forbidden', 403, 'name');
      }),
    );
    await app.ready();
  });
  beforeEach(() => {
    targetPath = join(directory, `target-${Math.random()}`);
  });
  afterAll(async () => {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  });

  const post = (url: string, parts: Part[]) =>
    app.inject({
      method: 'POST',
      url,
      headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
      payload: body(parts),
    });
  const codeOf = (response: { json: () => unknown }) =>
    (response.json() as { code: string }).code;

  describe('readMultipartForm', () => {
    it('returns the file and the expected fields in any order', async () => {
      const response = await post('/form', [
        file('abc'),
        field('language', 'cpp'),
      ]);
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        filename: 'a.txt',
        content: 'abc',
        fields: { language: 'cpp' },
      });
    });
    it.each([
      ['an unexpected field', [field('source', 'x'), file('abc')]],
      [
        'a repeated field',
        [field('language', 'a'), field('language', 'b'), file('abc')],
      ],
      ['a file under another name', [file('abc', 'other')]],
      ['an empty file', [file('')]],
    ])('rejects %s as validation_failed', async (_name, parts) => {
      const response = await post('/form', parts);
      expect([response.statusCode, codeOf(response)]).toEqual([
        400,
        'validation_failed',
      ]);
    });
    it('rejects a file over the cap as file_too_large', async () => {
      const response = await post('/form', [file('x'.repeat(MAX_BYTES + 1))]);
      expect([response.statusCode, codeOf(response)]).toEqual([
        413,
        'file_too_large',
      ]);
    });
    it('accepts a file of exactly the cap', async () => {
      const response = await post('/form', [file('x'.repeat(MAX_BYTES))]);
      expect(response.statusCode).toBe(200);
    });
    it('rejects a request that is not multipart', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/form',
        headers: { 'content-type': 'text/plain' },
        payload: 'plain',
      });
      expect([response.statusCode, codeOf(response)]).toEqual([
        400,
        'validation_failed',
      ]);
    });
  });

  describe('saveMultipartFile', () => {
    it('streams the file to the target path and counts its bytes', async () => {
      const response = await post('/save', [file('abc')]);
      expect(response.json()).toEqual({ filename: 'a.txt', bytes: 3 });
      expect(existsSync(targetPath)).toBe(true);
    });
    it('answers 413 and removes the partial file when the upload is truncated', async () => {
      const response = await post('/save', [file('x'.repeat(MAX_BYTES + 1))]);
      expect([response.statusCode, codeOf(response)]).toEqual([
        413,
        'file_too_large',
      ]);
      expect(existsSync(targetPath)).toBe(false);
    });
    it('lets the filename check reject before anything is written', async () => {
      const response = await post('/save', [
        { name: 'file', value: 'abc', filename: 'b.txt' },
      ]);
      expect([response.statusCode, codeOf(response)]).toEqual([
        403,
        'forbidden',
      ]);
      expect(existsSync(targetPath)).toBe(false);
    });
  });
});
