import { Injectable, Logger } from '@nestjs/common';
import { UsersRepository } from '@libs/auth';
import type { Principal } from '@libs/auth';
import { Paginated, unique } from '@libs/common';
import { uuidStr } from '@libs/database';
import type { Organization, Revision } from '@libs/database';
import { fieldDiff } from '@libs/problems';
import { UserSummaryResponse } from '../../problems/core/dto/user-summary.response';
import { RevisionsRepository } from '../../problems/core/revisions.repository';
import { OrganizationRevisionResponse } from './dto/organization-revision.response';
import type { OrganizationRevisionAction } from './dto/organization-revision.response';

const ENTITY = 'organization';
const PAGE_SIZE = 20;
const REVISION_FIELDS = [
  'name',
  'slug',
  'shortName',
  'about',
  'isOpen',
  'isUnlisted',
  'slots',
  'logoOverrideImage',
] as const;
const EMPTY_VALUES: readonly unknown[] = [null, ''];
const REVISION_COMMENT = {
  create: 'Created on site',
  edit: 'Edited from site',
  kick: 'Member removed',
  delete: 'Deleted',
} as const;

type OrganizationFields = Partial<
  Pick<Organization, (typeof REVISION_FIELDS)[number] | 'adminIds'>
>;

/** Legacy `VersionAdmin` history of organizations: who changed what, admins recorded by username so the history reads without ids. */
@Injectable()
export class OrganizationRevisionsService {
  private readonly logger = new Logger(OrganizationRevisionsService.name);

  constructor(
    private readonly revisions: RevisionsRepository,
    private readonly users: UsersRepository,
  ) {}

  /** Records the fields that differ; an edit that changed nothing records nothing. */
  async recordChange(
    principal: Principal,
    organizationId: string,
    change: {
      action: 'create' | 'edit';
      before: OrganizationFields;
      after: OrganizationFields;
    },
  ): Promise<void> {
    const [before, after] = await Promise.all([
      this.revisionView(change.before),
      this.revisionView(change.after),
    ]);
    const changes = fieldDiff(before, after);
    if (!Object.keys(changes).length) return;
    await this.append(principal, organizationId, change.action, changes);
  }

  recordKick(
    principal: Principal,
    organizationId: string,
    username: string,
  ): Promise<void> {
    return this.append(principal, organizationId, 'kick', {
      member: { before: username, after: null },
    });
  }

  recordDelete(principal: Principal, organizationId: string): Promise<void> {
    return this.append(principal, organizationId, 'delete', {
      deleted: { before: null, after: true },
    });
  }

  /** Newest first, 20 per page. */
  async history(
    organizationId: string,
    page: number,
  ): Promise<Paginated<OrganizationRevisionResponse>> {
    const { items, total } = await this.revisions.page(
      ENTITY,
      organizationId,
      page,
      PAGE_SIZE,
    );
    const editors = await this.editorsOf(items);
    return new Paginated(
      items.map((row) =>
        OrganizationRevisionResponse.from(
          row,
          (row.userId && editors.get(uuidStr(row.userId))) || null,
        ),
      ),
      { page, pageSize: PAGE_SIZE, total },
    );
  }

  /** Best effort: the change is already committed, so a failed history write is logged, never turned into a 500. */
  private async append(
    principal: Principal,
    organizationId: string,
    action: OrganizationRevisionAction,
    changes: Revision['changes'],
  ): Promise<void> {
    try {
      await this.revisions.append({
        entity: ENTITY,
        entityId: organizationId,
        action,
        userId: principal.userId,
        changes,
        comment: REVISION_COMMENT[action],
      });
    } catch (error) {
      this.logger.warn(
        `Could not record the ${action} of organization ${organizationId}: ${String(error)}`,
      );
    }
  }

  private async revisionView(
    fields: OrganizationFields,
  ): Promise<Record<string, unknown>> {
    // Empty values are left out: `fieldDiff` reads a missing field as null, so a create records no null-to-null rows.
    const view: Record<string, unknown> = Object.fromEntries(
      REVISION_FIELDS.filter(
        (field) => !EMPTY_VALUES.includes(fields[field] ?? null),
      ).map((field) => [field, fields[field]]),
    );
    if (fields.adminIds) view.admins = await this.adminNames(fields.adminIds);
    return view;
  }

  /** Sorted usernames; an admin whose account is gone keeps their id, so the diff still shows them. */
  private async adminNames(adminIds: readonly string[]): Promise<string[]> {
    const ids = adminIds.map(uuidStr);
    const names = new Map(
      (await this.users.findByIds(ids)).map((admin) => [
        uuidStr(admin._id),
        admin.username,
      ]),
    );
    return ids.map((id) => names.get(id) ?? id).sort();
  }

  private async editorsOf(
    rows: Revision[],
  ): Promise<Map<string, UserSummaryResponse>> {
    const ids = unique(
      rows.flatMap((row) => (row.userId ? [uuidStr(row.userId)] : [])),
    );
    const editors = await this.users.findByIds(ids);
    return new Map(
      editors.map((editor) => [
        uuidStr(editor._id),
        UserSummaryResponse.from(editor),
      ]),
    );
  }
}
