import { mongo } from 'mongoose';
import type { Connection } from 'mongoose';

/** GridFS bucket holding generation bundles (worker → judge) and result zips (judge → worker). */
export const TEST_GENERATION_BUCKET = 'testGenerations';

export const generationBucket = (connection: Connection): mongo.GridFSBucket =>
  new mongo.GridFSBucket(connection.db!, {
    bucketName: TEST_GENERATION_BUCKET,
  });
