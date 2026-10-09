import type { OpenAPIObject, SchemaObject } from '@nestjs/swagger';
import { CONTEST_RULES_MAX } from '@libs/database';
import { loadDocument, operationOf } from './document';
import { looseSites } from './schema-scans';

const OWN_SITE =
  /^schema (CreateContestDto|UpdateContestDto|ContestDetailResponse|ContestSettingsResponse|JoinBodyDto|ParticipationResponse)\b/;

describe('contest rules, acceptance and auto-publish schemas', () => {
  let document: OpenAPIObject;
  beforeAll(async () => {
    document = await loadDocument();
  });
  const schema = (name: string) => {
    const found = document.components?.schemas?.[name];
    if (!found) throw new Error(`The document has no schema ${name}`);
    return found as SchemaObject;
  };
  const properties = (name: string) =>
    schema(name).properties as Record<string, SchemaObject>;

  it('has no loose site on the schemas this lane touches', () => {
    expect(looseSites(document).filter((site) => OWN_SITE.test(site))).toEqual(
      [],
    );
  });

  it('documents the rules text, its HTML and its revision', () => {
    expect(properties('CreateContestDto').rules).toMatchObject({
      type: 'string',
      maxLength: CONTEST_RULES_MAX,
    });
    expect(properties('UpdateContestDto').rules).toMatchObject({
      type: 'string',
    });
    expect(properties('ContestDetailResponse')).toMatchObject({
      rules: { type: 'string' },
      rulesHtml: { type: 'string' },
      rulesRevision: { type: 'number' },
    });
  });

  it('takes acceptRules on register and join and reports the acceptance', () => {
    for (const route of [
      '/api/internal/contests/{key}/register',
      '/api/internal/contests/{key}/join',
    ])
      expect(operationOf(document, route, 'post').requestBody).toMatchObject({
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/JoinBodyDto' },
          },
        },
      });
    expect(properties('JoinBodyDto')).toMatchObject({
      accessCode: { type: 'string' },
      acceptRules: { type: 'boolean' },
    });
    for (const name of [
      'ParticipationSummaryResponse',
      'ParticipationResponse',
    ])
      expect(properties(name)).toMatchObject({
        rulesAcceptedAt: {
          type: 'string',
          format: 'date-time',
          nullable: true,
        },
        rulesAcceptedRevision: { type: 'number', nullable: true },
      });
  });

  it('documents the auto-publish switch on the editor body and the settings', () => {
    expect(properties('CreateContestDto').publishAfterEnd).toMatchObject({
      type: 'boolean',
    });
    expect(properties('UpdateContestDto').publishAfterEnd).toMatchObject({
      type: 'boolean',
    });
    expect(properties('ContestSettingsResponse')).toMatchObject({
      publishAfterEnd: { type: 'boolean' },
      publishAfterEndBy: { type: 'string', nullable: true },
    });
  });
});
