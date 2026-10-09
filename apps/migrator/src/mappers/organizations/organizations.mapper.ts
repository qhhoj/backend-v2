import { Injectable } from '@nestjs/common';
import type { UUID } from 'mongodb';
import { LegacySourceService } from '../../legacy-source.service';
import {
  groupBy,
  MapCtx,
  MappedDocument,
  Mapper,
  withoutFields,
} from '../../mapper';

type Row = {
  id: number;
  name: string;
  slug: string;
  short_name: string;
  about: string | null;
  creation_date: Date;
  is_open: number;
  slots: number | null;
  logo_override_image: string | null;
  performance_points: number;
  member_count: number;
  is_unlisted: number;
};

/** Owned by the `organization-points` job (D3). */
const RECOMPUTED = ['performancePoints', 'memberCount', 'updatedAt'];

@Injectable()
export class OrganizationsMapper implements Mapper<Row> {
  name = 'organizations';
  collection = 'organizations';
  refTables = ['judge_organization', 'judge_profile', 'auth_user'];
  sql = `SELECT id, name, slug, short_name, about, creation_date, is_open, slots, logo_override_image,
    performance_points, member_count, is_unlisted FROM judge_organization ORDER BY id`;
  private admins = new Map<number, number[]>();

  async prepare(source: LegacySourceService) {
    this.admins = groupBy(
      await source.query<{ organization_id: number; profile_id: number }>(
        'SELECT organization_id, profile_id FROM judge_organization_admins ORDER BY id',
      ),
      'organization_id',
      (row) => row.profile_id,
    );
  }

  map(row: Row, ctx: MapCtx): MappedDocument {
    return {
      _id: ctx.ref('judge_organization', row.id)!,
      name: row.name,
      slug: row.slug,
      shortName: row.short_name,
      about: row.about ?? '',
      aboutHtml: ctx.render(row.about, 'user', `judge_organization:${row.id}`),
      adminIds: this.adminIds(row.id, ctx),
      isOpen: ctx.bool(row.is_open),
      isUnlisted: ctx.bool(row.is_unlisted),
      slots: row.slots,
      logoOverrideImage: row.logo_override_image ?? '',
      performancePoints: row.performance_points ?? 0,
      memberCount: row.member_count ?? 0,
      createdAt: ctx.date(row.creation_date),
      updatedAt: ctx.date(row.creation_date),
    };
  }

  normalize(doc: MappedDocument) {
    return withoutFields(doc, RECOMPUTED);
  }

  /** Admins need not be members here: the audit counts them, and the list is copied as it is. */
  private adminIds(organizationId: number, ctx: MapCtx): UUID[] {
    return (this.admins.get(organizationId) ?? [])
      .map((profileId) => ctx.refOrNull('judge_profile', profileId))
      .filter((id): id is UUID => id !== null);
  }
}
