/** Test-only: a raw frame (4-byte big-endian length + body). Task 8 moves this into `fake-judge.ts`. */
export const frameOf = (body: Buffer): Buffer => {
  const header = Buffer.alloc(4);
  header.writeUInt32BE(body.length);
  return Buffer.concat([header, body]);
};
