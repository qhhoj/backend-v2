import type { OpenAPIObject, SchemaObject } from '@nestjs/swagger';
import { loadDocument } from './document';
import { looseSites } from './schema-scans';

describe('contest problem limits schema', () => {
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

  it('has no loose site on ContestProblemResponse', () => {
    expect(
      looseSites(document).filter((site) =>
        /^schema ContestProblemResponse\b/.test(site),
      ),
    ).toEqual([]);
  });

  it('documents both limits as nullable numbers', () => {
    expect(properties('ContestProblemResponse')).toMatchObject({
      timeLimit: { type: 'number', nullable: true },
      memoryLimit: { type: 'number', nullable: true },
    });
  });
});
