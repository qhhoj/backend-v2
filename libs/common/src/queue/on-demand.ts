import { failureOf } from './job-contract';
import type { JobProducer } from './job-producer';

/** What is kept for one on-demand build: nothing, a build queued or running, or a failure with the seconds left of its window and its `JobFailure` message (null for any other failure). */
export type OnDemandState =
  | { status: 'none' }
  | { status: 'building' }
  | { status: 'failed'; failure: string | null; retryAfterSeconds: number };

/**
 * A build a reader requests and then polls (a statement PDF, a package), kept under its contract's job id: a queued or running build is shared.
 * A failed one stays for the contract's `removeOnFail.age`, so a poll answers 503 instead of rebuilding in a loop; `JobProducer.addReplacingFailed` starts the next one.
 */
export async function onDemandState<Payload>(
  producer: JobProducer<Payload>,
  payload: Payload,
  now = Date.now(),
): Promise<OnDemandState> {
  const job = await producer.job(producer.idOf(payload));
  if (!job) return { status: 'none' };
  if (!(await job.isFailed())) return { status: 'building' };
  const { removeOnFail } = producer.contract.options;
  const windowMs =
    typeof removeOnFail === 'object' && 'age' in removeOnFail
      ? (removeOnFail.age ?? 0) * 1000
      : 0;
  return {
    status: 'failed',
    failure: failureOf(producer.contract, job),
    retryAfterSeconds: Math.ceil(
      ((job.finishedOn ?? 0) + windowMs - now) / 1000,
    ),
  };
}
