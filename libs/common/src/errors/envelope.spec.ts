import { AppError } from './app.error';
import { errorEnvelope } from './envelope';
import { issueError } from './issue-error';

describe('errorEnvelope', () => {
  it('puts code and message last, so extra members never override them', () => {
    const { error } = errorEnvelope(
      new AppError('c', 409, 'm', undefined, undefined, {
        code: 'other',
        message: 'other',
        hint: 'h',
      }),
    );
    expect(error).toMatchObject({ code: 'c', message: 'm', hint: 'h' });
  });

  it('carries no issues on a 5xx, and one request-level issue on a bare 4xx', () => {
    expect(errorEnvelope(new AppError('x', 503, 'down')).error).toEqual({
      code: 'x',
      message: 'down',
    });
    expect(errorEnvelope(new AppError('x', 400, 'bad')).error.issues).toEqual([
      { field: '', code: 'x', message: 'bad' },
    ]);
  });

  it('renders the one entry of an issueError as the only issue', () => {
    const { error } = errorEnvelope(
      issueError('forbidden', 403, { field: 'f', code: 'why', message: 'm' }),
    );
    expect(error).toEqual({
      code: 'forbidden',
      message: 'm',
      issues: [{ field: 'f', code: 'why', message: 'm' }],
    });
  });
});
