import { LegacySourceService } from '../../legacy-source.service';
import { groupBy, MapCtx } from '../../mapper';
import { UserRow } from './user-row';

type Credential = {
  id: number;
  profile_id: number;
  name: string;
  cred_id: string;
  public_key: string;
  counter: number | string;
};
/** `extra_data` (OAuth access/refresh tokens) is never selected: v2 writes `{}`. */
type Social = { user_id: number; provider: string; uid: string };

/** The M2M and child rows of users, keyed by legacy user or profile id (each table is small: at most tens of thousands of rows). */
export class UserRelations {
  private groups = new Map<number, number[]>();
  private permissions = new Map<number, string[]>();
  private organizations = new Map<number, number[]>();
  private credentials = new Map<number, Credential[]>();
  private social = new Map<number, Social[]>();
  private badgeHolders = new Set<number>();

  async load(source: LegacySourceService): Promise<void> {
    this.badgeHolders = new Set(
      (
        await source.query<{ profile_id: number }>(
          'SELECT DISTINCT profile_id FROM judge_profile_badges',
        )
      ).map((row) => row.profile_id),
    );
    this.groups = groupBy(
      await source.query<{ user_id: number; group_id: number }>(
        'SELECT user_id, group_id FROM auth_user_groups ORDER BY id',
      ),
      'user_id',
      (row) => row.group_id,
    );
    this.permissions = groupBy(
      await source.query<{ user_id: number; permission: string }>(
        `SELECT up.user_id, CONCAT(ct.app_label, '.', p.codename) AS permission FROM auth_user_user_permissions up
         JOIN auth_permission p ON p.id = up.permission_id JOIN django_content_type ct ON ct.id = p.content_type_id ORDER BY up.id`,
      ),
      'user_id',
      (row) => row.permission,
    );
    this.organizations = groupBy(
      await source.query<{ profile_id: number; organization_id: number }>(
        'SELECT profile_id, organization_id FROM judge_profile_organizations ORDER BY profile_id, sort_value, id',
      ),
      'profile_id',
      (row) => row.organization_id,
    );
    this.credentials = groupBy(
      await source.query<Credential>(
        'SELECT id, user_id AS profile_id, name, cred_id, public_key, counter FROM judge_webauthncredential ORDER BY id',
      ),
      'profile_id',
      (row) => row,
    );
    this.social = groupBy(
      await source.query<Social>(
        'SELECT user_id, provider, uid FROM social_auth_usersocialauth ORDER BY id',
      ),
      'user_id',
      (row) => row,
    );
  }

  /** D6: badges are dropped; a holder is reported once. */
  reportBadges(row: UserRow, ctx: MapCtx): void {
    if (
      row.display_badge_id != null ||
      this.badgeHolders.has(row.profile_id ?? -1)
    )
      ctx.report('badges not migrated');
  }

  fieldsOf(row: UserRow, ctx: MapCtx) {
    const profileId = row.profile_id ?? -1;
    return {
      groups: (this.groups.get(row.id) ?? [])
        .map((id) => ctx.refOrNull('auth_group', id))
        .filter((id) => id !== null),
      permissions: this.permissions.get(row.id) ?? [],
      organizations: (this.organizations.get(profileId) ?? [])
        .map((id) => ctx.refOrNull('judge_organization', id))
        .filter((id) => id !== null),
      webauthnCredentials: (this.credentials.get(profileId) ?? []).map(
        (credential) => ({
          _id: ctx.ref('judge_webauthncredential', credential.id)!,
          name: credential.name,
          credId: credential.cred_id,
          publicKey: credential.public_key,
          counter: Number(credential.counter),
        }),
      ),
      socialAuth: (this.social.get(row.id) ?? []).map((link) => ({
        provider: link.provider,
        uid: link.uid,
        extraData: {},
      })),
    };
  }
}
