import { legacyFernetDecrypt, legacyWebauthnHandle } from '@libs/auth';
import { decrypt, encrypt, encryptionKey } from '@libs/common';
import { Binary } from 'mongodb';
import { requiredEnv } from '../../legacy-env';
import { LegacySourceService } from '../../legacy-source.service';
import { MapCtx } from '../../mapper';

/** Legacy django-fernet-fields secrets re-sealed with the v2 AES-GCM key (spec: Encryption). */
export class LegacySecrets {
  constructor(
    private readonly legacyKey: string,
    private readonly key: Buffer,
  ) {}

  static fromEnv(): LegacySecrets {
    return new LegacySecrets(
      requiredEnv('LEGACY_SECRET_KEY'),
      encryptionKey(requiredEnv('ENCRYPTION_KEY')),
    );
  }

  /**
   * The canary: a wrong key would otherwise import every TOTP account with 2FA off and derive every WebAuthn handle wrong, and `verify` (same key) would still say 0.
   * Uses the first `totp_key`, else the first `scratch_codes`. Returns false when there is no token to test.
   */
  async assertKey(source: LegacySourceService): Promise<boolean> {
    const [canary] = await source.query<{ token: Buffer | string }>(
      `SELECT COALESCE(NULLIF(totp_key, ''), NULLIF(scratch_codes, '')) AS token FROM judge_profile
       WHERE LENGTH(totp_key) > 0 OR LENGTH(scratch_codes) > 0
       ORDER BY LENGTH(totp_key) > 0 DESC, id LIMIT 1`,
    );
    if (!canary) return false;
    try {
      legacyFernetDecrypt(canary.token.toString(), this.legacyKey);
    } catch {
      throw new Error('LEGACY_SECRET_KEY does not decrypt legacy secrets');
    }
    return true;
  }

  /** A legacy Fernet token (longblob bytes) sealed for v2; null when empty or undecryptable (reported). */
  reseal(
    token: Buffer | string | null,
    where: string,
    ctx: MapCtx,
  ): string | null {
    const text = token == null ? '' : token.toString();
    if (!text) return null;
    try {
      return encrypt(legacyFernetDecrypt(text, this.legacyKey), this.key);
    } catch {
      ctx.report(`undecryptable secret ${where}`);
      return null;
    }
  }

  /** Plain text for verify: the random IV makes two seals of one secret differ. A seal under another key opens as null, so verify counts a mismatch instead of aborting. */
  open(sealed: unknown): string | null {
    if (typeof sealed !== 'string') return null;
    try {
      return decrypt(sealed, this.key);
    } catch {
      return null;
    }
  }

  handle(profileId: number): Binary {
    return new Binary(legacyWebauthnHandle(this.legacyKey, profileId));
  }
}
