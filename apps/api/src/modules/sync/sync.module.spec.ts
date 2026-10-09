import { Logger } from '@nestjs/common';
import type { IntegrationClientsRepository } from '@libs/auth';
import { SyncModule } from './sync.module';

describe('SyncModule boot warning', () => {
  const boot = async (trustProxy: false | string, activeClients: number) => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const clients = {
      countActive: () => Promise.resolve(activeClients),
    } as unknown as IntegrationClientsRepository;
    await new SyncModule(clients, { trustProxy }).onApplicationBootstrap();
    const calls = warn.mock.calls.length;
    warn.mockRestore();
    return calls;
  };

  it('warns once when active clients exist and TRUST_PROXY is off', async () => {
    expect(await boot(false, 2)).toBe(1);
  });

  it('stays quiet behind a trusted proxy or without active clients', async () => {
    expect(await boot('loopback', 2)).toBe(0);
    expect(await boot(false, 0)).toBe(0);
  });
});
