/** Bounds of the judge link (`bridge-timings.ts` has the timings); `Welcome.limits` tells the judge the ones it must respect. */

/** gRPC max receive per message; grpc-js refuses a larger one with RESOURCE_EXHAUSTED before the handler sees it. */
export const MAX_MESSAGE_BYTES = 4 * 1024 * 1024;
/** Hello is the only message read before a judge is registered, so it gets a smaller cap. */
export const MAX_HELLO_BYTES = 256 * 1024;
/** Messages handled per second per session; each costs at most one Mongo write. */
export const MAX_MESSAGES_PER_SECOND = 1000;
export const MAX_CASES_PER_MESSAGE = 256;
/** At least the 9999 cases a problem may have; bounds one submission document. */
export const MAX_SUBMISSION_CASES = 10000;
/** Bytes, for compile logs and Final logs (clipped, not refused). */
export const MAX_LOG_BYTES = 65536;
export const MAX_SLOTS = 64;
export const MAX_RUNTIMES = 500;
export const MAX_FEATURES = 64;
export const MAX_LABEL_BYTES = 200;
/** Sockets beyond this are refused (`net.Server.maxConnections`). */
export const MAX_JUDGE_CONNECTIONS = 256;
/** Sockets per address with no authenticated session; the port must still be reachable from judge hosts only. */
export const MAX_UNAUTHENTICATED_PER_ADDRESS = 8;
/** FetchSource chunk size. */
export const SOURCE_CHUNK_BYTES = 1024 * 1024;
/** Failed key checks per address in `FAILED_AUTH_WINDOW_MS`; the address is then refused until the window ends. */
export const MAX_FAILED_AUTH_PER_ADDRESS = 20;
export const FAILED_AUTH_WINDOW_MS = 60_000;
/** A socket closed by the bridge (judge revoked, replaced by a newer socket) gets this long to deliver its sessions' final statuses. */
export const SOCKET_FLUSH_MS = 1000;
