import { newId } from '@libs/database';
import { UUID } from 'mongodb';
import { gradedJobOf } from './queues';

describe('gradedJobOf', () => {
  it('reads string ids from a hydrated row', () => {
    const [submissionId, userId, problemId] = [newId(), newId(), newId()];
    expect(
      gradedJobOf({ _id: submissionId, user: userId, problem: problemId }),
    ).toEqual({ submissionId, userId, problemId });
  });
  it('reads string ids from a lean row holding BSON UUIDs', () => {
    const [submissionId, userId, problemId] = [newId(), newId(), newId()];
    expect(
      gradedJobOf({
        _id: new UUID(submissionId),
        user: new UUID(userId),
        problem: new UUID(problemId),
      }),
    ).toEqual({ submissionId, userId, problemId });
  });
});
