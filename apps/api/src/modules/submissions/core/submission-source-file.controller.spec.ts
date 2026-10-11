import { AppError } from '@libs/common';
import type { AuthContext } from '@libs/auth';
import type { FastifyReply } from 'fastify';
import { SubmissionSourceFileController } from './submission-source-file.controller';
import type { SubmissionsService } from './submissions.service';

const auth = { principal: { userId: 'u' } } as unknown as AuthContext;

function fakeReply() {
  const headers: Record<string, string> = {};
  const reply = {
    type: (value: string) => ((headers['Content-Type'] = value), reply),
    header: (name: string, value: string) => ((headers[name] = value), reply),
  };
  return { reply: reply as unknown as FastifyReply, headers };
}

function controllerFor(sourceFile: SubmissionsService['sourceFile']) {
  return new SubmissionSourceFileController({
    sourceFile,
  } as unknown as SubmissionsService);
}

describe('SubmissionSourceFileController', () => {
  const found = () =>
    Promise.resolve({ filename: 'abc.cpp', text: 'int main(){}' });

  it('serves raw source as inline UTF-8 text that browsers must not sniff', async () => {
    const { reply, headers } = fakeReply();
    const text = await controllerFor(found).raw({ id: 'abc' }, auth, reply);
    expect(text).toBe('int main(){}');
    expect(headers).toEqual({
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': 'inline; filename="abc.cpp"',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    });
  });

  it('serves the download as an attachment named by the service', async () => {
    const { reply, headers } = fakeReply();
    await controllerFor(found).download({ id: 'abc' }, auth, reply);
    expect(headers['Content-Disposition']).toBe(
      'attachment; filename="abc.cpp"',
    );
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
  });

  it('passes the access refusal through and sends no file headers', async () => {
    const { reply, headers } = fakeReply();
    const hidden = () =>
      Promise.reject(new AppError('hidden', 403, 'You cannot see this'));
    const controller = controllerFor(hidden);
    await expect(controller.raw({ id: 'abc' }, auth, reply)).rejects.toThrow(
      'You cannot see this',
    );
    await expect(
      controller.download({ id: 'abc' }, auth, reply),
    ).rejects.toThrow('You cannot see this');
    expect(headers).toEqual({});
  });
});
