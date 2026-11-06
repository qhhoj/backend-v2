import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AppError } from '@libs/common';
import { QuotaLedger } from '@libs/problems';
import type { ChargeJournal } from '../problem-data-upload.service';
import { StoredUploads } from './stored-uploads';
import { UploadSessionsStore } from './upload-sessions.store';
import type { UploadSession } from './upload-sessions.store';

const isBusy = (error: unknown) =>
  error instanceof AppError && error.status === 409;

/**
 * The charge a complete holds while its write runs (`journalOf`). Every refund of it goes through one claim
 * (`refundOnce`), `charged`'s own on a failed write included, so it is given back at most once; a finished write closes
 * the claim (`settle`) and releases the hold. A hold left after that means the process died inside the write: whatever
 * ends or retries the session first settles it, under the session's lock: the next complete, a cancel, a refused upload,
 * or the sweep once the session expired. It is given back unless the write finished (`StoredUploads`).
 * Not covered: a crash between the spend and the hold, or a Redis flush, loses that refund.
 */
@Injectable()
export class HeldCharges {
  private readonly logger = new Logger(HeldCharges.name);

  constructor(
    private readonly sessions: UploadSessionsStore,
    private readonly ledger: QuotaLedger,
    private readonly stored: StoredUploads,
  ) {}

  journalOf(session: UploadSession): ChargeJournal {
    const claim = `chunked-upload:${session.id}:${randomUUID()}`;
    const { problemId, name, size, sha256 } = session;
    return {
      claim,
      opened: (spent) =>
        this.sessions.holdCharge(session, {
          claim,
          spent,
          upload: { problemId, name, size, sha256 },
        }),
      settled: () => this.settleStored(session.id, claim),
    };
  }

  /** The upload is stored: the charge stands. Never throws; a failure is logged (the closed claim already keeps any later give-back from refunding it). */
  async settleStored(id: string, claim?: string): Promise<void> {
    try {
      const held = claim ?? (await this.sessions.heldCharge(id))?.claim;
      if (held !== undefined && !(await this.ledger.settle(held)))
        this.logger.error(
          `The charge of upload ${id} was given back although it is stored`,
        );
      await this.sessions.releaseCharge(id);
    } catch (error) {
      this.logger.error(
        `Settling the charge of upload ${id} failed: ${(error as Error).message}`,
      );
    }
  }

  /** Under the session's lock, the upload not stored: gives back the charge it still holds (once, by its claim) and forgets it. */
  async giveBack(id: string): Promise<void> {
    const held = await this.sessions.heldCharge(id);
    if (held !== null) await this.ledger.refundOnce(held.claim, held.spent);
    await this.sessions.releaseCharge(id);
  }

  /** The sweep's part: settles the charges of sessions that are gone. Each takes the session's lock, so a complete still writing (it renews the lock) is skipped. */
  async settleAbandoned(): Promise<void> {
    for (const id of await this.sessions.heldChargeIds())
      await this.sessions
        .withSessionLock(id, () => this.settleIfGone(id))
        .catch((error: unknown) => {
          if (!isBusy(error)) throw error;
        });
  }

  private async settleIfGone(id: string): Promise<void> {
    if (await this.sessions.isOpen(id)) return;
    const held = await this.sessions.heldCharge(id);
    if (held !== null && (await this.stored.isStoredById(held.upload)))
      return this.settleStored(id, held.claim);
    await this.giveBack(id);
  }
}
