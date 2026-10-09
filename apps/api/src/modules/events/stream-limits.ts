/** Live event streams, counted per api process. */
export interface StreamLimits {
  /** Open streams per signed-in user: one `user` stream per tab plus a submission, ticket or contest stream on some pages. */
  perUser: number;
  /** Open streams (all channels) per client IP (`request.ip`, which honours `TRUST_PROXY`). */
  perIp: number;
  /** Open streams per client IP listed in `SSE_IP_ALLOWLIST`, instead of `perIp`: a school lab sits behind one NAT address, so its machines share one IP. Only listed addresses get it (a blanket raise would let one machine hold hundreds of streams); per-user and total caps still apply. */
  perAllowlistedIp: number;
  /** Open streams per api process. */
  total: number;
  /** Open public-feed streams per api process (the feed needs no login, so it gets a tighter cap). */
  feedTotal: number;
  /** Open contest streams per api process (anonymous viewers of public contests included, so they get their own cap like the feed). */
  contestTotal: number;
  /** Open `user` (notification) streams per api process: one per signed-in tab, with their own cap like the feed. Kept well below `total` (half): at `total` itself notification streams (every signed-in tab holds one) could take every slot and starve submission, contest and ticket streams. */
  userTotal: number;
  /** Hard bound on a client's backlog (`response.writableLength`: output queue plus socket write buffer; memory); a client that merely stops draining is dropped sooner, after `DRAIN_GRACE_MS`. The kernel's socket buffers hold more on top, per connection. */
  maxBufferedBytes: number;
  /** Ticket events waiting for their lookup per api process; beyond it events are dropped and the streams told to resync. */
  ticketBacklog: number;
  heartbeatMs: number;
  /** How often streams re-check the session and the channel's access rules (a few lookups per stream per tick, one stream after another, so a tick can outlast this and the next is skipped: keep it at tens of seconds). */
  recheckMs: number;
}
export const STREAM_LIMITS = Symbol('STREAM_LIMITS');
export const DEFAULT_STREAM_LIMITS: StreamLimits = {
  perUser: 12,
  perIp: 16,
  perAllowlistedIp: 512,
  total: 5000,
  feedTotal: 1000,
  contestTotal: 2000,
  userTotal: 2500,
  maxBufferedBytes: 256 * 1024,
  ticketBacklog: 1000,
  heartbeatMs: 15_000,
  recheckMs: 60_000,
};
