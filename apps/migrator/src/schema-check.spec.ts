import { createConnection } from 'mongoose';
import { Group, GroupSchema, newId, toUuid } from '@libs/database';
import { schemaErrors } from './schema-check';

describe('schemaErrors', () => {
  const conn = createConnection();
  conn.model(Group.name, GroupSchema);
  afterAll(() => conn.close());

  it('lists the paths the v2 model refuses', () =>
    expect(
      schemaErrors(conn, 'groups', { _id: toUuid(newId()), permissions: [] }),
    ).toEqual(['name: required']));
  it('accepts a valid document', () =>
    expect(
      schemaErrors(conn, 'groups', {
        _id: toUuid(newId()),
        name: 'Staff',
        permissions: [],
      }),
    ).toEqual([]));
  it('has nothing to say about a collection without a model', () =>
    expect(
      schemaErrors(conn, 'testTagGroups', { _id: toUuid(newId()) }),
    ).toEqual([]));
  it('names a top-level field the model does not declare (a mapper typo the model would drop silently)', () =>
    expect(
      schemaErrors(conn, 'groups', {
        _id: toUuid(newId()),
        name: 'x',
        permissions: [],
        typo: 1,
      }),
    ).toEqual(['typo: not in schema']));
});
