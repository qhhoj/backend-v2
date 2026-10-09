import type { OpenAPIObject, SchemaObject } from '@nestjs/swagger';
import { loadDocument } from './document';
import { looseSites } from './schema-scans';

describe('submission problem reference', () => {
  let document: OpenAPIObject;
  beforeAll(async () => {
    document = await loadDocument();
  });

  it('documents isDeleted as a required boolean next to code and name', () => {
    const problem = document.components?.schemas
      ?.SubmissionProblemResponse as SchemaObject;
    expect(problem.properties?.isDeleted).toMatchObject({ type: 'boolean' });
    expect(problem.required).toEqual(
      expect.arrayContaining(['code', 'name', 'isDeleted']),
    );
  });

  it('has no loose site on the problem reference', () => {
    expect(
      looseSites(document).filter((site) =>
        /SubmissionProblemResponse\b/.test(site),
      ),
    ).toEqual([]);
  });
});
