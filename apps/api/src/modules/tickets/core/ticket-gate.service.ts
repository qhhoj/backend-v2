import { Injectable } from '@nestjs/common';
import { UsersRepository } from '@libs/auth';
import type { Principal } from '@libs/auth';
import { AppError } from '@libs/common';

const MUTED_MESSAGE = 'Muted users cannot open or answer tickets';

/** 403 `forbidden` whose issue code `muted` tells the SPA a mute from a lost ticket access. */
const mutedError = () =>
  new AppError('forbidden', 403, MUTED_MESSAGE, undefined, undefined, {
    issues: [{ field: '', code: 'muted', message: MUTED_MESSAGE }],
  });

/** The interaction gate of tickets: only "not muted" (no solved-problem minimum, no official-contest lock). */
@Injectable()
export class TicketGateService {
  constructor(private readonly users: UsersRepository) {}

  async assertCanWrite(principal: Principal): Promise<void> {
    if ((await this.users.signedIn(principal)).mute) throw mutedError();
  }
}
