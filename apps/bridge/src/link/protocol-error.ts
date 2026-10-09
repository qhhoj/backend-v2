import { status } from '@grpc/grpc-js';
import { ErrorCode } from '@libs/judge-proto';

/** The judge broke the protocol: the session sends `BridgeError{code}` and ends with `grpcStatus`. */
export class ProtocolError extends Error {
  constructor(
    message: string,
    readonly code: ErrorCode = ErrorCode.ERROR_CODE_PROTOCOL,
    readonly grpcStatus: status = status.INVALID_ARGUMENT,
  ) {
    super(message);
  }
}

export const tooLarge = (message: string): ProtocolError =>
  new ProtocolError(
    message,
    ErrorCode.ERROR_CODE_TOO_LARGE,
    status.RESOURCE_EXHAUSTED,
  );

export const seqGap = (message: string): ProtocolError =>
  new ProtocolError(message, ErrorCode.ERROR_CODE_SEQ_GAP);

export const flood = (): ProtocolError =>
  new ProtocolError(
    'more than 1000 messages in a second',
    ErrorCode.ERROR_CODE_FLOOD,
    status.RESOURCE_EXHAUSTED,
  );
