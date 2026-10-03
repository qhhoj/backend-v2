import { ProblemSchema } from '@libs/database';
import {
  CLONE_COPIED_FIELDS,
  CLONE_RESET_FIELDS,
} from './problem-editing.service';

describe('clone field coverage', () => {
  it('decides every schema path as copied or reset', () => {
    const schemaPaths = Object.keys(ProblemSchema.paths).map((path) =>
      path === '_id' ? 'id' : path,
    );
    expect([...CLONE_COPIED_FIELDS, ...CLONE_RESET_FIELDS].sort()).toEqual(
      schemaPaths.sort(),
    );
  });
});
