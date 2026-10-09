import { ServerCredentials } from '@grpc/grpc-js';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serverCredentials } from './server-credentials';

describe('serverCredentials', () => {
  const plain = { judgeBridgeTlsCert: null, judgeBridgeTlsKey: null };

  it('serves plaintext on loopback only', async () => {
    for (const host of ['127.0.0.1', '::1', 'localhost'])
      expect(
        await serverCredentials({ ...plain, judgeBridgeHost: host }),
      ).toBeInstanceOf(ServerCredentials);
    await expect(
      serverCredentials({ ...plain, judgeBridgeHost: '0.0.0.0' }),
    ).rejects.toThrow(/set JUDGE_BRIDGE_TLS_CERT and JUDGE_BRIDGE_TLS_KEY/);
  });

  it('reads the certificate pair when one is configured, and fails on a missing file', async () => {
    await expect(
      serverCredentials({
        judgeBridgeHost: '10.0.0.1',
        judgeBridgeTlsCert: '/nonexistent/cert.pem',
        judgeBridgeTlsKey: '/nonexistent/key.pem',
      }),
    ).rejects.toThrow(/ENOENT/);
  });

  it('serves TLS on a public host with a real pair, and a half-set pair is still plaintext-refused', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bridge-tls-'));
    try {
      const cert = join(dir, 'c.pem');
      const key = join(dir, 'k.pem');
      execFileSync(
        'openssl',
        `req -x509 -newkey rsa:2048 -nodes -days 1 -subj /CN=bridge -keyout ${key} -out ${cert}`.split(
          ' ',
        ),
        { stdio: 'ignore' },
      );
      const credentials = await serverCredentials({
        judgeBridgeHost: '10.0.0.1',
        judgeBridgeTlsCert: cert,
        judgeBridgeTlsKey: key,
      });
      expect(credentials).toBeInstanceOf(ServerCredentials);
      expect(credentials._isSecure()).toBe(true);
      await expect(
        serverCredentials({
          judgeBridgeHost: '10.0.0.1',
          judgeBridgeTlsCert: cert,
          judgeBridgeTlsKey: null,
        }),
      ).rejects.toThrow(/set JUDGE_BRIDGE_TLS_CERT/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
