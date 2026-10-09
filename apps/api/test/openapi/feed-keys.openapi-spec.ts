import type { OpenAPIObject, SchemaObject } from '@nestjs/swagger';
import { FEED_KEY_MODES } from '@libs/database';
import { loadDocument } from './document';
import { inlineEnumSites, looseSites } from './schema-scans';

const KEY_ROUTE = '/api/internal/contests/{key}/feed-key';

describe('feed key schemas', () => {
  let document: OpenAPIObject;
  beforeAll(async () => {
    document = await loadDocument();
  });
  const schema = (name: string) => {
    const found = document.components?.schemas?.[name];
    if (!found) throw new Error(`The document has no schema ${name}`);
    return found as SchemaObject;
  };
  const refersToMode = (name: string) =>
    JSON.stringify(schema(name).properties?.mode).includes(
      '#/components/schemas/FeedKeyMode',
    );

  it('has no loose site on the feed key routes and DTOs', () => {
    const own = looseSites(document).filter(
      (site) =>
        site.includes('/feed-key') ||
        /^schema (MintFeedKeyDto|MintedFeedKeyResponse|FeedKeyStatusResponse)\b/.test(
          site,
        ),
    );
    expect(own).toEqual([]);
  });

  it('shares one FeedKeyMode component between the mint body and both responses', () => {
    for (const name of [
      'MintFeedKeyDto',
      'MintedFeedKeyResponse',
      'FeedKeyStatusResponse',
    ])
      expect(refersToMode(name)).toBe(true);
    // One enumName reused for another set would merge them silently: the member count catches it.
    expect(schema('FeedKeyMode').enum).toHaveLength(FEED_KEY_MODES.length);
    expect(inlineEnumSites(document, FEED_KEY_MODES)).toEqual([]);
  });

  it('documents status, mint, revoke and release', () => {
    expect(Object.keys(document.paths[KEY_ROUTE] ?? {}).sort()).toEqual([
      'delete',
      'get',
      'post',
    ]);
    expect(Object.keys(document.paths[`${KEY_ROUTE}/release`] ?? {})).toEqual([
      'post',
    ]);
  });
});
