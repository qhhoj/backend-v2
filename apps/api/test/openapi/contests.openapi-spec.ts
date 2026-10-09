import type { OpenAPIObject, SchemaObject } from '@nestjs/swagger';
import {
  CONTEST_FORMAT_NAMES,
  LABEL_STYLES,
  SCOREBOARD_VISIBILITIES,
} from '@libs/database';
import { CONTEST_PHASES } from '@libs/contests';
import { CONTEST_ACTION_STATES } from '../../src/modules/contests/editing/dto/contest-actions.response';
import { announcementFrameData } from '../../src/modules/contests/announcements/contest-streams.service';
import { loadDocument, operationOf, parameterOf } from './document';
import { inlineEnumSites, looseSites } from './schema-scans';
import { frameDataKeys, streamEventNames } from './stream-frames';

describe('contest schemas', () => {
  let document: OpenAPIObject;
  beforeAll(async () => {
    document = await loadDocument();
  });
  const schema = (name: string) => {
    const found = document.components?.schemas?.[name];
    if (!found) throw new Error(`The document has no schema ${name}`);
    return found as SchemaObject;
  };

  /** Sites are labelled `GET <route> parameter <name>` or `schema <Name>.<property> ...`; enum sites are JSON paths. */
  const OWN_SITE =
    /\/api\/internal\/contests\b(?!\/\{key\}\/submissions)|(^schema |\/components\/schemas\/)(Contest|Announcement|Participation|Ranking|PrepareData|CreateContest|UpdateContest)/;
  const owned = (sites: string[]) =>
    sites.filter((site) => OWN_SITE.test(site));

  it('has no untyped parameter, empty schema or bare object on contest routes and schemas', () => {
    expect(owned(looseSites(document))).toEqual([]);
  });

  it('types paging as optional numbers and the ranking flag as an optional boolean', () => {
    for (const route of ['', '/{key}/announcements', '/{key}/participations'])
      for (const name of ['page', 'pageSize'])
        expect(
          parameterOf(
            document,
            { route: `/api/internal/contests${route}`, method: 'get' },
            name,
          ),
        ).toMatchObject({ required: false, schema: { type: 'number' } });
    expect(
      parameterOf(
        document,
        { route: '/api/internal/contests/{key}/ranking', method: 'get' },
        'virtual',
      ),
    ).toMatchObject({ required: false, schema: { type: 'boolean' } });
  });

  it('shares named enums for format, label style, action state, phase and scoreboard visibility', () => {
    const named = [
      ['ContestFormatName', CONTEST_FORMAT_NAMES],
      ['ContestLabelStyle', LABEL_STYLES],
      ['ContestActionState', CONTEST_ACTION_STATES],
      ['ContestPhase', CONTEST_PHASES],
      ['ScoreboardVisibility', SCOREBOARD_VISIBILITIES],
    ] as const;
    for (const [name, values] of named) {
      // One enumName reused for another set would merge them silently: the member count catches it.
      expect(schema(name).enum).toHaveLength(values.length);
      expect(owned(inlineEnumSites(document, values))).toEqual([]);
    }
  });

  it('names the results filter of the data preparation as the shared SubmissionResult', () => {
    expect(
      JSON.stringify(schema('PrepareDataDto').properties!.results),
    ).toContain('#/components/schemas/SubmissionResult');
  });

  it('documents the contest data download as a zip file', () => {
    const operation = operationOf(
      document,
      '/api/internal/contests/{key}/data/download',
      'get',
    );
    expect(operation.responses['200']).toMatchObject({
      content: {
        'application/zip': { schema: { type: 'string', format: 'binary' } },
      },
    });
  });

  it('documents the contest stream with its announcement event and exactly the members it sends', () => {
    expect(
      streamEventNames(document, '/api/internal/events/contests/{key}'),
    ).toContain('announcement');
    const sent = announcementFrameData('c1', 'a1');
    expect(frameDataKeys(document, 'ContestAnnouncementFrame')).toEqual(
      Object.keys(sent).sort(),
    );
  });
});
