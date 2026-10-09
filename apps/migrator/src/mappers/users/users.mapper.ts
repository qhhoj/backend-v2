import { Injectable } from '@nestjs/common';
import { LegacySourceService } from '../../legacy-source.service';
import { MapCtx, MappedDocument, Mapper, withoutFields } from '../../mapper';
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
  private secrets!: LegacySecrets;

  async prepare(source: LegacySourceService) {
    this.secrets = LegacySecrets.fromEnv();
    await this.secrets.assertKey(source);
    await this.relations.load(source);
  }

  map(row: UserRow, ctx: MapCtx): MappedDocument {
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
      ...this.secondFactor(row, ctx),
      ...relations,
    };
  }

  normalize(doc: MappedDocument) {
    return {
      ...withoutFields(doc, RECOMPUTED),
      totpKey: this.secrets.open(doc.totpKey),
      scratchCodes: this.secrets.open(doc.scratchCodes),
    };
  }

  private secondFactor(row: UserRow, ctx: MapCtx) {
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
