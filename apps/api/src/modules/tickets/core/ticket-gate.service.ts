import { Injectable } from '@nestjs/common';
import { UsersRepository } from '@libs/auth';
import type { Principal } from '@libs/auth';
import { AppError } from '@libs/common';

/** The interaction gate of tickets: only "not muted" (no solved-problem minimum, no official-contest lock). */
@Injectable()
export class TicketGateService {
  constructor(private readonly users: UsersRepository) {}

  async assertCanWrite(principal: Principal): Promise<void> {
    if ((await this.users.signedIn(principal)).mute)
      throw new AppError(
        'forbidden',
        403,
        'Muted users cannot open or answer tickets',
      );
  }
}
