/** A stored cap at or above this is a legacy "no limit" stand-in (the site once held 226789), not a real limit: no contest problem takes 100 000 attempts. */
export const UNLIMITED_ATTEMPTS_FROM = 100_000;

/** The per-problem attempt cap a contestant meets: null (no cap) for an absent, non-positive or stand-in value. Every reader of `maxSubmissions` goes through here. */
export const attemptCap = (maxSubmissions: number | null): number | null =>
  maxSubmissions !== null &&
  maxSubmissions > 0 &&
  maxSubmissions < UNLIMITED_ATTEMPTS_FROM
    ? maxSubmissions
    : null;
