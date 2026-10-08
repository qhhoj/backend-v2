import { Inject, Injectable } from '@nestjs/common';
import {
  constantTimeEqual,
  generateScratchCodes,
  generateTotpSecret,
  matchTotp,
  otpauthUrl,
  SessionService,
  UsersRepository,
} from '@libs/auth';
import type { AuthContext, UserDocument } from '@libs/auth';
import { AppError, decrypt, ENV, encrypt, encryptionKey } from '@libs/common';
import type { Env } from '@libs/common';
import { AuthService } from '../core/auth.service';
import { SecondFactorService } from './second-factor.service';
import { ScratchCodesRemainingResponse } from './dto/totp.response';

const invalidCode = () =>
  new AppError('invalid_code', 400, 'Invalid authentication code');

const assertTotpEnabled: (
  user: UserDocument,
) => asserts user is UserDocument & { totpKey: string } = (user) => {
  if (!user.isTotpEnabled || !user.totpKey)
    throw new AppError('totp_not_enabled', 400, 'TOTP is not enabled');
};

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

  remainingScratchCodes(auth: AuthContext): ScratchCodesRemainingResponse {
    assertTotpEnabled(auth.user);
    return { remaining: this.storedScratchCodes(auth.user).length };
  }

  /** TOTP or scratch code; each is consumed by compare-and-set so one code authorizes exactly one request. */
  private async checkCode(user: UserDocument, code: string): Promise<void> {
    assertTotpEnabled(user);
    const release = await this.secondFactor.reserveAttempt(user._id);
    if (
      (await this.consumeTotpCode(user, code)) ||
      (await this.consumeScratchCode(user, code))
    )
      return release();
    throw invalidCode();
  }

  /** A TOTP step later than the last accepted one, recorded by CAS so it cannot be replayed. */
  private async consumeTotpCode(
    user: UserDocument & { totpKey: string },
    code: string,
  ): Promise<boolean> {
    const timecode = matchTotp(
      decrypt(user.totpKey, this.key),
      code,
      user.lastTotpTimecode,
    );
    if (timecode === null) return false;
    return this.users.advanceTotpTimecode(
      user._id,
      user.lastTotpTimecode,
      timecode,
    );
  }

  /** One of the stored scratch codes (case-insensitive), removed by CAS so it works once. */
  private async consumeScratchCode(
    user: UserDocument,
    code: string,
  ): Promise<boolean> {
    const codes = this.storedScratchCodes(user);
    const normalized = code.toUpperCase();
    if (!user.scratchCodes || !containsCode(codes, normalized)) return false;
    const unused = codes.filter((candidate) => candidate !== normalized);
    return this.users.replaceScratchCodes(
      user._id,
      user.scratchCodes,
      encrypt(JSON.stringify(unused), this.key),
    );
  }

  private storedScratchCodes(user: UserDocument): string[] {
    if (!user.scratchCodes) return [];
    return JSON.parse(decrypt(user.scratchCodes, this.key)) as string[];
  }
}
