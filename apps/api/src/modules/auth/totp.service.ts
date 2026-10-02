import { Inject, Injectable } from '@nestjs/common';
import {
  constantTimeEqual,
  decrypt,
  encrypt,
  encryptionKey,
  generateScratchCodes,
  generateTotpSecret,
  matchTotp,
  otpauthUrl,
  SessionService,
  UsersRepository,
} from '@libs/auth';
import type { AuthContext, UserDocument } from '@libs/auth';
import { AppError, ENV } from '@libs/common';
import type { Env } from '@libs/common';
import { AuthService } from './auth.service';
import { SecondFactorService } from './second-factor.service';

const invalidCode = () =>
  new AppError('invalid_code', 400, 'Invalid authentication code');

const alreadyEnabled = () =>
  new AppError('invalid_code', 400, 'TOTP is already enabled');

/** Compares against every candidate without early exit. */
const containsCode = (codes: string[], code: string): boolean => {
  let found = false;
  for (const candidate of codes)
    if (constantTimeEqual(candidate, code)) found = true;
  return found;
};

@Injectable()
export class TotpService {
  private readonly key: Buffer;

  constructor(
    private readonly users: UsersRepository,
    private readonly sessions: SessionService,
    private readonly secondFactor: SecondFactorService,
    private readonly authService: AuthService,
    @Inject(ENV) env: Env,
  ) {
    this.key = encryptionKey(env.encryptionKey);
  }

  // @SessionOnly() guarantees a session, so `auth.sessionId` is set on enroll/confirm.
  async enroll(
    auth: AuthContext,
    currentPassword: string,
  ): Promise<{ secret: string; otpauthUrl: string }> {
    await this.authService.confirmPassword(auth, currentPassword);
    if (auth.user.isTotpEnabled) throw alreadyEnabled();
    const secret = generateTotpSecret();
    await this.sessions.update(auth.sessionId!, {
      pendingTotpSecret: encrypt(secret, this.key),
    });
    return { secret, otpauthUrl: otpauthUrl(secret, auth.user.username) };
  }

  async confirm(
    auth: AuthContext,
    code: string,
  ): Promise<{ scratchCodes: string[] }> {
    if (auth.user.isTotpEnabled) throw alreadyEnabled();
    const sessionId = auth.sessionId!;
    // Atomic read+clear: concurrent confirms cannot both use one pending secret.
    const pending = await this.sessions.consume(sessionId, 'pendingTotpSecret');
    if (!pending) throw invalidCode();
    const secret = decrypt(pending, this.key);
    const timecode = matchTotp(secret, code, 0);
    if (timecode === null) {
      await this.sessions.update(sessionId, { pendingTotpSecret: pending });
      throw invalidCode();
    }
    const scratchCodes = generateScratchCodes();
    const enabled = await this.users.enableTotp(auth.user._id, {
      totpKey: encrypt(secret, this.key),
      scratchCodes: encrypt(JSON.stringify(scratchCodes), this.key),
      lastTotpTimecode: timecode,
    });
    if (!enabled) throw alreadyEnabled();
    return { scratchCodes };
  }

  async verify(auth: AuthContext, code: string): Promise<void> {
    if (auth.session?.twoFaPassed) return;
    await this.checkCode(auth.user, code);
    await this.secondFactor.complete(auth);
  }

  async disable(auth: AuthContext, code: string): Promise<void> {
    await this.checkCode(auth.user, code);
    await this.users.update(auth.user._id, {
      totpKey: null,
      scratchCodes: null,
      isTotpEnabled: false,
    });
  }

  async regenerateScratchCodes(
    auth: AuthContext,
    code: string,
  ): Promise<{ scratchCodes: string[] }> {
    await this.checkCode(auth.user, code);
    const scratchCodes = generateScratchCodes();
    await this.users.update(auth.user._id, {
      scratchCodes: encrypt(JSON.stringify(scratchCodes), this.key),
    });
    return { scratchCodes };
  }

  /** TOTP or scratch code; each is consumed by compare-and-set so one code authorizes exactly one request. */
  private async checkCode(user: UserDocument, code: string): Promise<void> {
    if (!user.isTotpEnabled || !user.totpKey)
      throw new AppError('totp_not_enabled', 400, 'TOTP is not enabled');
    const release = await this.secondFactor.reserveAttempt(user._id);
    const timecode = matchTotp(
      decrypt(user.totpKey, this.key),
      code,
      user.lastTotpTimecode,
    );
    if (
      timecode !== null &&
      (await this.users.advanceTotpTimecode(
        user._id,
        user.lastTotpTimecode,
        timecode,
      ))
    )
      return release();
    if (user.scratchCodes) {
      const codes = JSON.parse(
        decrypt(user.scratchCodes, this.key),
      ) as string[];
      const normalized = code.toUpperCase();
      if (
        containsCode(codes, normalized) &&
        (await this.users.replaceScratchCodes(
          user._id,
          user.scratchCodes,
          encrypt(
            JSON.stringify(
              codes.filter((candidate) => candidate !== normalized),
            ),
            this.key,
          ),
        ))
      )
        return release();
    }
    throw invalidCode();
  }
}
