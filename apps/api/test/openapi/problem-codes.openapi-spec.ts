import type { OpenAPIObject, SchemaObject } from '@nestjs/swagger';
import { PROBLEM_CODE_PATTERN } from '@libs/database';
import { loadDocument, parameterOf } from './document';
import { looseSites } from './schema-scans';

describe('problem code documentation', () => {
  let document: OpenAPIObject;
  beforeAll(async () => {
    document = await loadDocument();
  });
  const schema = (name: string) => {
    const found = document.components?.schemas?.[name];
    if (!found) throw new Error(`The document has no schema ${name}`);
    return found as SchemaObject;
  };

  it.each(['CreateProblemDto', 'CloneProblemDto'])(
    '%s requires a code and documents its pattern',
    (name) => {
      expect(schema(name).required).toContain('code');
      expect(schema(name).properties?.code).toMatchObject({
        type: 'string',
        pattern: PROBLEM_CODE_PATTERN.source,
      });
    },
  );

  it('documents the same pattern on the Polygon import query', () => {
    const code = parameterOf(
      document,
      { route: '/api/internal/problems/imports', method: 'post' },
      'code',
    );
    expect(code.required).toBe(true);
    expect(code.schema).toMatchObject({ pattern: PROBLEM_CODE_PATTERN.source });
  });

  it('has no loose site on the code properties', () => {
    expect(
      looseSites(document).filter((site) =>
        /(CreateProblemDto|CloneProblemDto|problems\/imports)\b/.test(site),
      ),
    ).toEqual([]);
  });
});
