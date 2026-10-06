import { newId } from '@libs/database';
import { Binary } from 'mongodb';
import { gradedJobOf } from './queues';

const uuidBinary = (id: string): Binary =>
  new Binary(Buffer.from(id.replaceAll('-', ''), 'hex'), Binary.SUBTYPE_UUID);

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
        _id: uuidBinary(submissionId),
        user: uuidBinary(userId),
        problem: uuidBinary(problemId),
      }),
    ).toEqual({ submissionId, userId, problemId });
  });
});
