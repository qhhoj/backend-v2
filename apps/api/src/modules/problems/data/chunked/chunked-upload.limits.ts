import { ZIP_LIMITS } from '@libs/problems';

/** Fixed by the server and returned at create: half of Cloudflare's 100 MB per request, under nginx's 64m on the chunk route. */
export const CHUNK_BYTES = 48 * 1024 * 1024;
/** The zip check refuses an archive that extracts to more (judge-v2's `BACKEND_ARCHIVE_MAX_BYTES` is the same). */
export const CHUNKED_UPLOAD_MAX_BYTES = ZIP_LIMITS.maxTotalBytes;
/** A session lives this long from its create, whatever its progress; its parts are swept after. */
export const UPLOAD_SESSION_TTL_SECONDS = 24 * 60 * 60;
/** Open sessions per user: each can hold up to 2 GiB of parts on disk. */
export const MAX_OPEN_UPLOAD_SESSIONS = 2;
/** One chunk write or the completion of a session at a time; renewed while it runs. */
export const UPLOAD_SESSION_LOCK_SECONDS = 60;

export const chunkCountOf = (size: number): number =>
  Math.ceil(size / CHUNK_BYTES);

/** Every chunk is `CHUNK_BYTES` long except the last, which holds the rest. */
export const chunkLengthOf = (size: number, index: number): number =>
  Math.min(CHUNK_BYTES, size - index * CHUNK_BYTES);
