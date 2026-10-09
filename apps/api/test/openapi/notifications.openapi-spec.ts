import type { OpenAPIObject, SchemaObject } from '@nestjs/swagger';
import { NOTIFICATION_KINDS, NOTIFICATION_PRIORITIES } from '@libs/database';
import { NOTIFICATION_STATES } from '../../src/modules/notifications/core/dto/notification-list.dto';
import { loadDocument, operationOf, parameterOf } from './document';
import { inlineEnumSites, looseSites } from './schema-scans';

const INBOX = '/api/internal/notifications';
const OWN_SITE =
  /\/api\/internal\/notifications|\/schemas\/(Notification|UnreadCount)/;

describe('notification inbox schemas', () => {
  let document: OpenAPIObject;
  beforeAll(async () => {
    document = await loadDocument();
  });
  const schema = (name: string) => {
    const found = document.components?.schemas?.[name];
    if (!found) throw new Error(`The document has no schema ${name}`);
    return found as SchemaObject;
  };
  const owned = (sites: string[]) =>
    sites.filter((site) => OWN_SITE.test(site));

  it('has no untyped parameter, empty schema or bare object on the inbox routes', () => {
    expect(owned(looseSites(document))).toEqual([]);
  });

  it('types the list query: page an optional number, state and priority optional named enums', () => {
    const list = { route: INBOX, method: 'get' } as const;
    expect(parameterOf(document, list, 'page')).toMatchObject({
      required: false,
      schema: { type: 'number' },
    });
    expect(JSON.stringify(parameterOf(document, list, 'state'))).toContain(
      '#/components/schemas/NotificationState',
    );
    expect(parameterOf(document, list, 'state')).toMatchObject({
      required: false,
    });
    expect(JSON.stringify(parameterOf(document, list, 'priority'))).toContain(
      '#/components/schemas/NotificationPriority',
    );
    expect(parameterOf(document, list, 'priority')).toMatchObject({
      required: false,
    });
  });

  it('types the kind query as an optional repeatable array of the named NotificationKind enum', () => {
    const kind = parameterOf(document, { route: INBOX, method: 'get' }, 'kind');
    expect(kind).toMatchObject({ required: false, schema: { type: 'array' } });
    expect(JSON.stringify(kind)).toContain(
      '#/components/schemas/NotificationKind',
    );
    expect(kind).not.toMatchObject({ explode: false });
  });

  it('names each enumeration once, with the members of its constant, and spells none inline', () => {
    // One enumName reused for another set would merge them silently: the member count catches it.
    expect(schema('NotificationKind').enum).toHaveLength(
      NOTIFICATION_KINDS.length,
    );
    expect(schema('NotificationPriority').enum).toHaveLength(
      NOTIFICATION_PRIORITIES.length,
    );
    expect(schema('NotificationState').enum).toHaveLength(
      NOTIFICATION_STATES.length,
    );
    for (const values of [
      NOTIFICATION_KINDS,
      NOTIFICATION_PRIORITIES,
      NOTIFICATION_STATES,
    ])
      expect(owned(inlineEnumSites(document, values))).toEqual([]);
  });

  it('documents the kind and priority of a row as the named enums', () => {
    const properties = schema('NotificationResponse').properties!;
    expect(JSON.stringify(properties.kind)).toContain(
      '#/components/schemas/NotificationKind',
    );
    expect(JSON.stringify(properties.priority)).toContain(
      '#/components/schemas/NotificationPriority',
    );
  });

  it('documents readAt as a nullable date', () => {
    expect(schema('NotificationResponse').properties!.readAt).toMatchObject({
      type: 'string',
      format: 'date-time',
      nullable: true,
    });
  });

  it('documents both read routes as 204 without a body', () => {
    for (const route of [`${INBOX}/{id}/read`, `${INBOX}/read-all`])
      expect(
        Object.keys(operationOf(document, route, 'post').responses),
      ).toContain('204');
  });
});
