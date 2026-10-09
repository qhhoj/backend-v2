import type { OpenAPIObject, SchemaObject } from '@nestjs/swagger';
import { TICKET_TIMELINE_TYPES } from '@libs/database';
import { loadDocument } from './document';
import { inlineEnumSites, looseSites } from './schema-scans';

describe('ticket timeline schemas', () => {
  let document: OpenAPIObject;
  beforeAll(async () => {
    document = await loadDocument();
  });
  const schema = (name: string) => {
    const found = document.components?.schemas?.[name];
    if (!found) throw new Error(`The document has no schema ${name}`);
    return found as SchemaObject;
  };

  it('has no untyped, empty or bare-object site in its own schemas', () => {
    const own = looseSites(document).filter((site) =>
      /^schema (TicketTimelineEventResponse|TicketTimelineEntryResponse|TicketDetailResponse)\b/.test(
        site,
      ),
    );
    expect(own).toEqual([]);
  });

  it('documents the timeline beside the messages with the entry shape', () => {
    expect(Object.keys(schema('TicketDetailResponse').properties!)).toEqual(
      expect.arrayContaining(['messages', 'timeline']),
    );
    expect(
      Object.keys(schema('TicketTimelineEntryResponse').properties!).sort(),
    ).toEqual(['at', 'event', 'kind', 'message']);
    expect(
      schema('TicketTimelineEntryResponse').properties!.kind,
    ).toMatchObject({
      enum: ['message', 'event'],
    });
  });

  it('names the event types once and never spells them inline', () => {
    expect(
      JSON.stringify(schema('TicketTimelineEventResponse').properties!.type),
    ).toContain('#/components/schemas/TicketTimelineType');
    // One enumName reused for another set would merge them silently: the member count catches it.
    expect(schema('TicketTimelineType').enum).toHaveLength(
      TICKET_TIMELINE_TYPES.length,
    );
    expect(inlineEnumSites(document, TICKET_TIMELINE_TYPES)).toEqual([]);
  });
});
