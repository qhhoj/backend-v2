import { Injectable, Logger } from '@nestjs/common';
import { LegacySourceService } from '../../legacy-source.service';
import { MapCtx, MappedDocument, Mapper, withoutFields } from '../../mapper';
import { legacySecretsSkipped } from '../../rehearsal';
import { LegacySecrets } from './legacy-secrets';
import {
  accountFields,
  deactivatedBanFields,
  isLegacyDeactivated,
  profileStateFields,
  profileTextFields,
} from './user-fields';
import { UserRelations } from './user-relations';
import { USERS_SQL, UserRow } from './user-row';

/** Owned by the worker's recompute jobs (D3); copied from legacy, not compared. */
const RECOMPUTED = [
  'points',
  'performancePoints',
  'problemCount',
  'contributionPoints',
  'rating',
  'updatedAt',
];

const SECRETS_SKIPPED =
  'REHEARSAL: legacy secrets skipped, canary skipped, 2FA off for every user';
const TWO_FACTOR_OFF = '2FA off (legacy secrets skipped, rehearsal)';

/** What a user without migrated secrets gets: no TOTP, no WebAuthn (credentials without a handle would be a shape the real run never writes). */
const NO_SECOND_FACTOR = {
  isTotpEnabled: false,
  totpKey: null,
  scratchCodes: null,
  isWebauthnEnabled: false,
  webauthnUserHandle: null,
  webauthnCredentials: [],
};

/** 2FA the user had switched on in legacy; leftover key bytes alone do not count. */
const hasLegacySecondFactor = (row: UserRow): boolean =>
  Boolean(Number(row.is_totp_enabled) || Number(row.is_webauthn_enabled));

/** Without secrets verify compares presence only, so a sealed secret in Mongo still shows as a mismatch. */
const sealedPresence = (sealed: unknown): string | null =>
  typeof sealed === 'string' ? 'sealed' : null;

@Injectable()
export class UsersMapper implements Mapper<UserRow> {
  name = 'users';
  collection = 'users';
  refTables = [
    'auth_user',
    'judge_profile',
    'auth_group',
    'judge_organization',
    'judge_language',
    'judge_contestparticipation',
    'judge_webauthncredential',
  ];
  sql = USERS_SQL;
  private readonly relations = new UserRelations();
  private readonly logger = new Logger('users');
  /** Null only in a `--skip-legacy-secrets` rehearsal. */
  private secrets: LegacySecrets | null = null;
  private canarySkipped = false;
  private canaryReported = false;

  async prepare(source: LegacySourceService) {
    this.canaryReported = false;
    if (legacySecretsSkipped()) {
      this.secrets = null;
      this.canarySkipped = true;
      this.logger.warn(`!!! ${SECRETS_SKIPPED} !!!`);
    } else {
      this.secrets = LegacySecrets.fromEnv();
      this.canarySkipped = !(await this.secrets.assertKey(source));
    }
    await this.relations.load(source);
  }

  map(row: UserRow, ctx: MapCtx): MappedDocument {
    this.reportSkippedCanary(ctx);
    const relations = this.relations.fieldsOf(row, ctx);
    this.relations.reportBadges(row, ctx);
    if (
      isLegacyDeactivated(row) &&
      (Number(row.is_staff) ||
        Number(row.is_superuser) ||
        relations.groups.length ||
        relations.permissions.length)
    )
      ctx.report(`staff flags kept on deactivated auth_user:${row.id}`);
    return {
      _id: ctx.ref('auth_user', row.id)!,
      ...accountFields(row, ctx),
      ...profileTextFields(row, ctx),
      ...profileStateFields(row, ctx),
      ...deactivatedBanFields(row),
      ...relations,
      ...this.secondFactor(row, ctx),
    };
  }

  normalize(doc: MappedDocument) {
    return {
      ...withoutFields(doc, RECOMPUTED),
      totpKey: this.secrets
        ? this.secrets.open(doc.totpKey)
        : sealedPresence(doc.totpKey),
      scratchCodes: this.secrets
        ? this.secrets.open(doc.scratchCodes)
        : sealedPresence(doc.scratchCodes),
    };
  }

  /** `prepare` has no report handle, so the first row carries the line. */
  private reportSkippedCanary(ctx: MapCtx): void {
    if (!this.canarySkipped || this.canaryReported) return;
    this.canaryReported = true;
    ctx.report(
      this.secrets
        ? 'no legacy secret to test LEGACY_SECRET_KEY against (canary skipped)'
        : SECRETS_SKIPPED,
    );
  }

  private secondFactor(row: UserRow, ctx: MapCtx) {
    if (!this.secrets) {
      if (hasLegacySecondFactor(row)) ctx.report(TWO_FACTOR_OFF);
      return {
        ...NO_SECOND_FACTOR,
        lastTotpTimecode: row.last_totp_timecode ?? 0,
      };
    }
    const where = `judge_profile:${row.profile_id}`;
    const totpKey = this.secrets.reseal(row.totp_key, where, ctx);
    return {
      isTotpEnabled: ctx.bool(row.is_totp_enabled) && totpKey !== null,
      totpKey,
      scratchCodes: this.secrets.reseal(row.scratch_codes, where, ctx),
      lastTotpTimecode: row.last_totp_timecode ?? 0,
      isWebauthnEnabled: ctx.bool(row.is_webauthn_enabled),
      webauthnUserHandle:
        row.profile_id == null ? null : this.secrets.handle(row.profile_id),
    };
  }
}
