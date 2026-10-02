import { Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { Env } from '@libs/common';
import { PwnedPasswordService } from './pwned-password.service';

const sha1 = (text: string) =>
  createHash('sha1').update(text).digest('hex').toUpperCase();
const service = (pwnedApiUrl: string | null) =>
  new PwnedPasswordService({ pwnedApiUrl } as Env);

describe('PwnedPasswordService', () => {
  let server: Server;
  let baseUrl: string;
  const requestedPaths: string[] = [];

  beforeAll(async () => {
    server = createServer((request, response) => {
      requestedPaths.push(request.url ?? '');
      response.end(
        `0000000000000000000000000000000000A:3\r\n${sha1('password123').slice(5)}:24230577\r\n`,
      );
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise((resolve) => server.close(resolve)));

  afterEach(() => jest.restoreAllMocks());

  it('detects a breached password using only the hash prefix', async () => {
    expect(await service(baseUrl).isPwned('password123')).toBe(true);
    expect(requestedPaths.at(-1)).toBe(
      `/range/${sha1('password123').slice(0, 5)}`,
    );
  });
  it('passes an unbreached password', async () =>
    expect(await service(baseUrl).isPwned('correct horse battery')).toBe(
      false,
    ));
  it('fails open when the API is unreachable', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    expect(await service('http://127.0.0.1:1').isPwned('password123')).toBe(
      false,
    );
    expect(warn).toHaveBeenCalled();
  });
  it('tolerates trailing slashes in the base URL', async () => {
    expect(await service(`${baseUrl}//`).isPwned('password123')).toBe(true);
    expect(requestedPaths.at(-1)).toBe(
      `/range/${sha1('password123').slice(0, 5)}`,
    );
  });
  it('is disabled without a URL', async () =>
    expect(await service(null).isPwned('password123')).toBe(false));
});
