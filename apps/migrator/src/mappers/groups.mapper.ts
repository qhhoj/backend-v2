import { Injectable } from '@nestjs/common';
import { LegacySource } from '../legacy-source';
import { groupBy, MapCtx, Mapper } from '../mapper';

type Row = { id: number; name: string };

@Injectable()
export class GroupsMapper implements Mapper<Row> {
  name = 'groups';
  collection = 'groups';
  refTables = ['auth_group'];
  sql = 'SELECT id, name FROM auth_group ORDER BY id';
  private permissions = new Map<number, string[]>();

  async prepare(source: LegacySource) {
    const rows = await source.query<{ group_id: number; permission: string }>(
      `SELECT gp.group_id, CONCAT(ct.app_label, '.', p.codename) AS permission FROM auth_group_permissions gp
       JOIN auth_permission p ON p.id = gp.permission_id JOIN django_content_type ct ON ct.id = p.content_type_id ORDER BY gp.id`,
    );
    this.permissions = groupBy(rows, 'group_id', (row) => row.permission);
  }

  map(row: Row, ctx: MapCtx) {
    return {
      _id: ctx.ref('auth_group', row.id)!,
      name: row.name,
      permissions: this.permissions.get(row.id) ?? [],
      createdAt: null,
      updatedAt: null,
    };
  }
}
