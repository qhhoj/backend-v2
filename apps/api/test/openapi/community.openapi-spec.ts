import type { OpenAPIObject, SchemaObject } from '@nestjs/swagger';
import { COMMENT_PAGE_TYPES } from '@libs/database';
import { SETTING_KEYS } from '@libs/settings';
import { ACTIVITY_DAYS_MAX, VOTE_SCORES } from '@libs/community';
import type { TicketEvent } from '@libs/community';
import { ticketEventData } from '../../src/modules/tickets/streams/ticket-streams.service';
import { loadDocument, operationOf, parameterOf } from './document';
import { inlineEnumSites, looseSites } from './schema-scans';
import { frameDataKeys, streamEventNames } from './stream-frames';

/** The routes this lane owns: community, tickets, site, settings and activity (plus the blog and comments modules). */
const OWNED_ROUTE =
  /\/api\/internal\/(posts|admin\/posts|users\/\{username\}\/blog|organizations\/\{slug\}\/posts|comments|tickets|problems\/\{code\}\/tickets|admin\/site|admin\/settings|admin\/user-activity|home|feeds|events\/tickets)\b/;
/** Sites are labelled `GET <route> parameter <name>` or `schema <Name>.<property> ...`; enum sites are JSON paths. */
const OWNED_SCHEMA =
  /^schema (VoteDto|UpdateSettingDto|Post|Comment|Recent|Vote|Ticket|Setting|Activity|Flatpage|Site|Navigation|Live|Create|Update|New|Hide|PutMisc|Page|Blog)|\/components\/schemas\/(Post|Comment|Vote|Ticket|Setting|Activity|Flatpage|Site|Navigation|Live|Recent)/;
const isOwned = (site: string) =>
  OWNED_ROUTE.test(site) || OWNED_SCHEMA.test(site);

const PAGED = [
  '/api/internal/posts',
  '/api/internal/admin/posts',
  '/api/internal/users/{username}/blog',
  '/api/internal/organizations/{slug}/posts',
  '/api/internal/comments/pages/{type}/{key}',
  '/api/internal/tickets',
  '/api/internal/problems/{code}/tickets',
  '/api/internal/admin/site/pages',
  '/api/internal/admin/site/pages/{id}/revisions',
  '/api/internal/admin/settings/{key}/revisions',
  '/api/internal/admin/user-activity/logs',
  '/api/internal/admin/user-activity/users/{username}/logs',
  '/api/internal/admin/user-activity/live',
];
const DAYS = [
  '/api/internal/admin/user-activity/logs',
  '/api/internal/admin/user-activity/logs/export',
  '/api/internal/admin/user-activity/users/{username}/logs',
  '/api/internal/admin/user-activity/users/{username}/summary',
];
const TICKET_STREAMS = [
  '/api/internal/events/tickets',
  '/api/internal/events/tickets/{id}',
];

const aTicketEvent = (): TicketEvent => ({
  type: 'ticket-status',
  ticketId: '0b6f6e0e-0f4c-4a4e-9a55-5f3c7c1d2e10',
  messageId: null,
  open: false,
});

describe('community, ticket, site, settings and activity schemas', () => {
  let document: OpenAPIObject;
  beforeAll(async () => {
    document = await loadDocument();
  });
  const schema = (name: string) => {
    const found = document.components?.schemas?.[name];
    if (!found) throw new Error(`The document has no schema ${name}`);
    return found as SchemaObject;
  };
  const ownedSites = (sites: string[]) => sites.filter(isOwned);

  it('has no untyped parameter or empty schema on the routes and DTOs it owns', () => {
    expect(ownedSites(looseSites(document))).toEqual([]);
  });

  it('types paging and day windows as optional numbers', () => {
    for (const route of PAGED)
      expect(
        parameterOf(document, { route, method: 'get' }, 'page'),
      ).toMatchObject({
        required: false,
        schema: { type: 'number' },
      });
    for (const route of DAYS)
      expect(
        parameterOf(document, { route, method: 'get' }, 'days'),
      ).toMatchObject({
        required: false,
        schema: { type: 'number', maximum: ACTIVITY_DAYS_MAX },
      });
  });

  it('documents the vote score as -1, 0 or 1 on the vote body', () => {
    expect(schema('VoteDto').properties).toHaveProperty('score');
    expect(
      schema('VoteScore')
        .enum?.map(Number)
        .sort((left, right) => left - right),
    ).toEqual([-1, 0, 1]);
    expect(ownedSites(inlineEnumSites(document, VOTE_SCORES))).toEqual([]);
  });

  it('shares one CommentPageType enum by reference at every comment page site', () => {
    expect(schema('CommentPageType').enum?.length).toBe(
      COMMENT_PAGE_TYPES.length,
    );
    const linkType = schema('CommentPageLinkResponse').properties?.type as
      { $ref?: string; allOf?: Array<{ $ref?: string }> } | undefined;
    expect(linkType?.$ref ?? linkType?.allOf?.[0]?.$ref).toBe(
      '#/components/schemas/CommentPageType',
    );
    expect(ownedSites(inlineEnumSites(document, COMMENT_PAGE_TYPES))).toEqual(
      [],
    );
  });

  const refOf = (site: unknown) => {
    const { $ref, allOf } = site as {
      $ref?: string;
      allOf?: Array<{ $ref?: string }>;
    };
    return $ref ?? allOf?.[0]?.$ref;
  };

  it('documents viewerVote on the vote response as the VoteScore enum', () => {
    const response = schema('VoteResponse');
    expect(refOf(response.properties?.viewerVote)).toBe(
      '#/components/schemas/VoteScore',
    );
    expect(response.required).toContain('viewerVote');
  });

  it('documents the flatpage wildcard as a path parameter', () => {
    expect(
      parameterOf(
        document,
        { route: '/api/internal/pages/{path}', method: 'get' },
        'path',
      ),
    ).toMatchObject({ in: 'path', required: true, schema: { type: 'string' } });
    expect(
      operationOf(document, '/api/internal/pages/{path}', 'get'),
    ).toBeDefined();
  });

  it('types the setting key as the named enum of the registry keys', () => {
    expect((schema('SettingKey').enum ?? []).map(String).sort()).toEqual(
      [...SETTING_KEYS].sort(),
    );
    expect(refOf(schema('SettingResponse').properties?.key)).toBe(
      '#/components/schemas/SettingKey',
    );
  });

  it('types each flatpage revision change as { before, after }', () => {
    const changes = schema('FlatpageRevisionResponse').properties
      ?.changes as SchemaObject;
    expect(refOf(changes.additionalProperties)).toBe(
      '#/components/schemas/FieldChangeResponse',
    );
    expect(schema('FieldChangeResponse').required?.sort()).toEqual([
      'after',
      'before',
    ]);
  });

  it('keeps the setting value any JSON value, not an object', () => {
    const value = schema('UpdateSettingDto').properties!.value as SchemaObject;
    expect(value).not.toHaveProperty('type');
    expect(value.nullable).toBe(true);
  });

  it('documents the ticket streams with their three events and resync', () => {
    for (const route of TICKET_STREAMS)
      expect(streamEventNames(document, route).sort()).toEqual([
        'new-ticket',
        'resync',
        'ticket-message',
        'ticket-status',
      ]);
  });

  it('documents exactly the members the ticket emitter sends', () => {
    expect(frameDataKeys(document, 'TicketEventFrame')).toEqual(
      Object.keys(ticketEventData(aTicketEvent())).sort(),
    );
  });
});
