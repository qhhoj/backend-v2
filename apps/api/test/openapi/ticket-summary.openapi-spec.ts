import type { OpenAPIObject, SchemaObject } from '@nestjs/swagger';
import { loadDocument, operationOf } from './document';
import { looseSites } from './schema-scans';

describe('ticket summary route', () => {
  let document: OpenAPIObject;
  beforeAll(async () => {
    document = await loadDocument();
  });

  it('has no untyped, empty or bare-object site on its own route and schema', () => {
    const own = looseSites(document).filter((site) =>
      /tickets\/summary|TicketSummaryResponse/.test(site),
    );
    expect(own).toEqual([]);
  });

  it('answers with the two counts as numbers', () => {
    const ok = operationOf(document, '/api/internal/tickets/summary', 'get')
      .responses['200'] as { content: Record<string, { schema: unknown }> };
    expect(ok.content['application/json'].schema).toMatchObject({
      properties: {
        data: { $ref: '#/components/schemas/TicketSummaryResponse' },
      },
    });
    const schema = document.components!.schemas!
      .TicketSummaryResponse as SchemaObject;
    expect(schema.properties).toMatchObject({
      assignedOpen: { type: 'number' },
      awaitingStaff: { type: 'number' },
    });
  });
});
