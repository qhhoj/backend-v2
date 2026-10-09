import type { OpenAPIObject, SchemaObject } from '@nestjs/swagger';
import { CONTEST_RULES_MAX } from '@libs/database';
import { loadDocument } from './document';
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
});
