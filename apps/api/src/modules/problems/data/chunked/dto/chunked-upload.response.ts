export class ChunkedUploadResponse {
  /** Session id. */
  id!: string;
  /** The archive's name once stored. */
  name!: string;
  /** Size of the whole file in bytes. */
  size!: number;
  /** Bytes of every chunk but the last, which holds the rest. */
  chunkBytes!: number;
  /** Number of chunks. */
  chunkCount!: number;
  /** Indexes of the chunks the server holds, ascending; send the others. */
  received!: number[];
  /** When the session and its chunks are dropped. */
  expiresAt!: Date;
}
