import { hashPassword } from '@libs/auth';
import type { RateLimitService } from '@libs/common';
import { AuthService } from './auth.service';

describe('AuthService budget refunds', () => {
  it('refunds a wrong password once, even when the refund itself fails', async () => {
    const releaseFailure = jest.fn(() => Promise.resolve());
    const releaseSuccess = jest
      .fn<Promise<void>, []>()
      .mockRejectedValueOnce(new Error('redis down'));
    const rateLimit = {
      reserve: () => Promise.resolve(releaseFailure),
      claim: () => Promise.resolve(releaseSuccess),
    } as unknown as RateLimitService;
    const auth = new AuthService(
      ...([
        null,
        null,
        null,
        null,
        rateLimit,
        {},
      ] as unknown as ConstructorParameters<typeof AuthService>),
    );
    const context = {
      principal: { userId: 'user-1' },
      user: { password: await hashPassword('the right one', 1000) },
    } as unknown as Parameters<AuthService['confirmPassword']>[0];
    await expect(auth.confirmPassword(context, 'wrong')).rejects.toThrow(
      'redis down',
    );
    expect(releaseSuccess).toHaveBeenCalledTimes(1);
    expect(releaseFailure).not.toHaveBeenCalled();
  });
});
