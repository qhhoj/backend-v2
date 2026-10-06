import { newId } from '@libs/database';
import { enqueueGraded } from './queues';

describe('enqueueGraded', () => {
  it('retries a failed job with exponential backoff: effects are idempotent recomputes', async () => {
    const add = jest.fn(() => Promise.resolve());
    await enqueueGraded({ add } as never, {
      submissionId: newId(),
      userId: newId(),
      problemId: newId(),
    });
    const [, , options] = add.mock.calls[0] as unknown as [
      string,
      unknown,
      { attempts: number; backoff: { type: string } },
    ];
    expect(options.attempts).toBe(3);
    expect(options.backoff.type).toBe('exponential');
  });
});
