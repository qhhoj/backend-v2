import { newId } from '@libs/database';
import { parseSubmissionEvent, submissionEvent } from './submission-events';
import type { SubmissionEvent } from './submission-events';

const subject = () => ({
  submissionId: newId(),
  userId: newId(),
  problemId: newId(),
});

describe('submission events', () => {
  it.each<SubmissionEvent>([
    submissionEvent(subject(), 'queued', 'QU'),
    submissionEvent(subject(), 'test-case', 'G', 7),
    submissionEvent(subject(), 'done', 'AB'),
  ])('round-trips %j', (event) =>
    expect(parseSubmissionEvent(JSON.stringify(event))).toEqual(event),
  );

  it('keeps only the contract fields', () => {
    const event = submissionEvent(subject(), 'done', 'D');
    expect(
      parseSubmissionEvent(
        JSON.stringify({ ...event, source: 'int main() {}', cases: [] }),
      ),
    ).toEqual(event);
  });

  it.each([
    'not json',
    'null',
    JSON.stringify({
      ...submissionEvent(subject(), 'test-case', 'G'),
      currentTestcase: 1.5,
    }),
    JSON.stringify({
      ...submissionEvent(subject(), 'done', 'D'),
      type: 'explode',
    }),
    JSON.stringify({
      ...submissionEvent(subject(), 'done', 'D'),
      status: 'PD',
    }),
    JSON.stringify({ ...submissionEvent(subject(), 'done', 'D'), userId: '1' }),
    JSON.stringify({
      ...submissionEvent(subject(), 'test-case', 'G'),
      currentTestcase: -1,
    }),
  ])('ignores %s', (raw) => expect(parseSubmissionEvent(raw)).toBeNull());
});
