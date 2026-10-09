import { writeFileSync } from 'node:fs';
import { canonicalJson } from '@libs/common';
import { loadDocument } from './document';

it('writes the OpenAPI document to $OPENAPI_OUT', async () => {
  const target = process.env.OPENAPI_OUT;
  if (!target)
    throw new Error('OPENAPI_OUT is not set: run `npm run openapi:emit`');
  writeFileSync(target, canonicalJson(await loadDocument()));
});
