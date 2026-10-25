/** Live event streams, counted per api process. */
export interface StreamLimits {
  /** Open streams per signed-in user: one `user` stream per tab plus a submission, ticket or contest stream on some pages. */
  perUser: number;
  /** Open streams (all channels) per client address (`limiterAddress` of `request.ip`, which honours `TRUST_PROXY`: an IPv6 client counts per /64). */
  perIp: number;
  /** Open streams per client IP listed in `SSE_IP_ALLOWLIST`, instead of `perIp`: a school lab sits behind one NAT address, so its machines share one IP. Only listed addresses get it (a blanket raise would let one machine hold hundreds of streams); per-user and total caps still apply. */
  perAllowlistedIp: number;
  /** Open streams per api process. */
  total: number;
  /** Open public-feed streams per api process (the feed needs no login, so it gets a tighter cap). */
  feedTotal: number;
  /** Open contest streams per api process (anonymous viewers of public contests included, so they get their own cap like the feed). */
  contestTotal: number;
  /** Open contest event-feed streams (ICPC resolver tools, HTTP Basic with a feed key) per api process: a resolver holds one or two, so a small cap of their own. */
  contestFeedTotal: number;
  /** Open `user` (notification) streams per api process: one per signed-in tab, with their own cap like the feed. Together with `feedTotal`, `contestTotal` and `contestFeedTotal` it must leave `total` minus their sum (500 by default) to the submission and ticket streams, which have no cap of their own: those slots are reserved for them. */
  userTotal: number;
  /** Hard bound on a client's backlog (`response.writableLength`: output queue plus socket write buffer; memory); a client that merely stops draining is dropped sooner, after `DRAIN_GRACE_MS`. The kernel's socket buffers hold more on top, per connection. */
  maxBufferedBytes: number;
  /** Ticket events waiting for their lookup per api process; beyond it events are dropped and the streams told to resync. */
  ticketBacklog: number;
  /** Public-feed events waiting for their lookups per api process; beyond it events are dropped and the feed told to resync. */
  feedBacklog: number;
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
  feedTotal: 900,
  contestTotal: 1500,
  contestFeedTotal: 100,
  userTotal: 2000,
  maxBufferedBytes: 256 * 1024,
  ticketBacklog: 1000,
  feedBacklog: 1000,
  heartbeatMs: 15_000,
  recheckMs: 60_000,
};
