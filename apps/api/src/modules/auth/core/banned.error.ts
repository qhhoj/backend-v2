import { AppError } from '@libs/common';

/** A login refused because the account is banned; `banReason` is also a structured member so the SPA never parses the message. */
export class BannedError extends AppError {
  constructor(reason: string) {
    super(
      'banned',
      403,
      `This account has been banned. Reason: ${reason}`,
      undefined,
      undefined,
      { banReason: reason },
    );
  }
}
