import version from '../proto/version.json';

export * from './generated/qhhoj/judge/v1/judge';
export { PROTO_ROOT } from './proto-root';

/** `proto/version.json`: the v1 minor this side speaks (`Hello`/`Welcome.protocolMinor`). */
export const PROTOCOL_MINOR: number = version.minor;
