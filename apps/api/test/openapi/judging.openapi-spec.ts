import type { OpenAPIObject, SchemaObject } from '@nestjs/swagger';
import { SUBMISSION_RESULTS, SUBMISSION_STATUSES } from '@libs/database';
import { SUBMISSION_EVENT_TYPES, submissionEvent } from '@libs/judging';
import {
  feedEventOf,
  stateOf,
} from '../../src/modules/submissions/streams/submission-streams.service';
import { loadDocument, parameterOf } from './document';
import { inlineEnumSites, looseSites } from './schema-scans';
import { frameDataKeys, streamEventNames } from './stream-frames';

describe('submission, judge and similarity schemas', () => {
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
    /\/api\/internal\/(submissions|judges|similarity)\b|\/contests\/\{key\}\/submissions|(^schema |\/components\/schemas\/)(Submission|Judge|DisconnectJudge|Similarity|Rejudge|BulkRejudge)/;
  const owned = (sites: string[]) =>
    sites.filter((site) => OWN_SITE.test(site));

  it('has no untyped parameter, empty schema or bare object on these routes', () => {
    expect(owned(looseSites(document))).toEqual([]);
  });

  it('types the submission list paging as optional numbers, also on the contest submissions route', () => {
    for (const route of [
      '/api/internal/submissions',
      '/api/internal/contests/{key}/submissions',
    ])
      for (const name of ['page', 'pageSize'])
        expect(
          parameterOf(document, { route, method: 'get' }, name),
        ).toMatchObject({ required: false, schema: { type: 'number' } });
  });

  it('types the similarity pair list paging as optional numbers', () => {
    for (const name of ['page', 'pageSize'])
      expect(
        parameterOf(
          document,
          {
            route: '/api/internal/similarity/runs/{runId}/pairs',
            method: 'get',
          },
          name,
        ),
      ).toMatchObject({ required: false, schema: { type: 'number' } });
  });

  it('shares one SubmissionStatus and one SubmissionResult enum across list, detail and filters', () => {
    expect(schema('SubmissionStatus').enum).toHaveLength(
      SUBMISSION_STATUSES.length,
    );
    expect(schema('SubmissionResult').enum).toHaveLength(
      SUBMISSION_RESULTS.length,
    );
    // PrepareDataDto.results (contests) is checked with the contests schemas; the global scan lives elsewhere.
    expect(owned(inlineEnumSites(document, SUBMISSION_STATUSES))).toEqual([]);
    expect(owned(inlineEnumSites(document, SUBMISSION_RESULTS))).toEqual([]);
  });

  it('types the judge disconnect flag as an optional boolean', () => {
    expect(schema('DisconnectJudgeDto').properties).toMatchObject({
      force: { type: 'boolean', default: false },
    });
  });

  it('documents the public feed and the single-submission stream with their event names', () => {
    expect(
      streamEventNames(document, '/api/internal/events/submissions'),
    ).toEqual(
      expect.arrayContaining(['queued', 'processing', 'grading-begin', 'done']),
    );
    expect(
      streamEventNames(document, '/api/internal/events/submissions/{id}'),
    ).toEqual(
      expect.arrayContaining([...SUBMISSION_EVENT_TYPES, 'state', 'resync']),
    );
  });

  it('documents exactly the members the emitters send in each frame', () => {
    const event = submissionEvent(
      { submissionId: 's1', userId: 'u1', problemId: 'p1' },
      'queued',
      SUBMISSION_STATUSES[0],
    );
    const state = stateOf(
      {
        _id: '0190a000-0000-7000-8000-000000000000',
        status: 'D',
        result: 'AC',
        points: 1,
        casePoints: 1,
        caseTotal: 1,
        currentTestcase: 1,
      },
      true,
    );
    const sorted = (value: object) => Object.keys(value).sort();
    expect(frameDataKeys(document, 'SubmissionProgressFrame')).toEqual(
      sorted(event),
    );
    expect(frameDataKeys(document, 'SubmissionFeedFrame')).toEqual(
      sorted(feedEventOf(event)),
    );
    expect(frameDataKeys(document, 'SubmissionStateFrame')).toEqual(
      sorted(state),
    );
  });
});
