import { AppError } from './app.error';
import { errorEnvelope } from './envelope';
import { issueError } from './issue-error';

describe('errorEnvelope', () => {
  it('carries no issues on a 5xx', () => {
    expect(errorEnvelope(new AppError('x', 503, 'down')).error).toEqual({
      code: 'x',
      message: 'down',
    });
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
