/** Runs `attempt` up to `attempts` times while it reports a lost compare-and-set race (false), each time reading afresh; true as soon as one attempt wins. An error from `attempt` is not retried. */
export async function retryOnConflict(
  attempt: () => Promise<boolean>,
  attempts: number,
): Promise<boolean> {
  for (let tried = 0; tried < attempts; tried += 1)
    if (await attempt()) return true;
  return false;
}
