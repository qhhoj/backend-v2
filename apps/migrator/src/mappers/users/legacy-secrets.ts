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

  /** The canary: a wrong key would otherwise import every TOTP account with 2FA off and derive every WebAuthn handle wrong, and `verify` (same key) would still say 0. */
  async assertKey(source: LegacySourceService): Promise<void> {
    const [canary] = await source.query<{ totp_key: Buffer | string }>(
      'SELECT totp_key FROM judge_profile WHERE totp_key IS NOT NULL AND LENGTH(totp_key) > 0 ORDER BY id LIMIT 1',
    );
    if (!canary) return;
    try {
      legacyFernetDecrypt(canary.totp_key.toString(), this.legacyKey);
    } catch {
      throw new Error('LEGACY_SECRET_KEY does not decrypt legacy secrets');
    }
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
