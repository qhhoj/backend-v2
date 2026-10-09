/** `$set` fields of every write that finishes a submission: its effects are due until the graded job (or the effects sweep) applied them. */
export const effectsDue = (): { effectsDueAt: Date } => ({
  effectsDueAt: new Date(),
});
