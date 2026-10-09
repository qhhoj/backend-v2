import { resolve } from 'node:path';

/** The vendored copy of judge-v2 `proto/` (contract, golden fixtures, conformance scenarios). */
export const PROTO_ROOT = resolve(__dirname, '..', 'proto');
