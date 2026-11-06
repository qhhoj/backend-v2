import { Injectable, Logger } from '@nestjs/common';
import { QuotaLedger } from '@libs/problems';
import type { ChargeJournal } from '../problem-data-upload.service';
import { UploadSessionsStore } from './upload-sessions.store';
import type { UploadSession } from './upload-sessions.store';

/**
 * The charge a complete holds while its write runs (`journalOf`): released when the write ends either way (`charged`
 * refunds a failed one). Held after that only when the process died inside the write: then it is given back once
 * (`refundOnce` by its claim) by whatever ends or retries the session first: the next complete, a cancel, a refused
 * upload, or the sweep once the session expired.
 */
@Injectable()
export class HeldCharges {
  private readonly logger = new Logger(HeldCharges.name);

  constructor(
    private readonly sessions: UploadSessionsStore,
    private readonly ledger: QuotaLedger,
  ) {}

  /** Releasing never throws: if it fails (Redis down) the charge stays held after `charged` settled it, and a later give-back would return it a second time; that is logged. */
  journalOf(session: UploadSession): ChargeJournal {
    return {
      opened: (spent) => this.sessions.holdCharge(session, spent),
      ended: () =>
        this.sessions.releaseCharge(session.id).catch((error: Error) => {
          this.logger.error(
            `Releasing the charge of upload ${session.id} failed: ${error.message}`,
          );
        }),
    };
  }

  /** Gives back the charge `id` still holds, once, and forgets it. */
  async giveBack(id: string): Promise<void> {
    const held = await this.sessions.heldCharge(id);
    if (held === null) return;
    await this.ledger.refundOnce(
      `chunked-upload:${id}:${held.claim}`,
      held.spent,
    );
    await this.sessions.releaseCharge(id);
  }

  /** The sweep's part: gives back the charges of sessions that are gone. */
  async giveBackAbandoned(): Promise<void> {
    for (const id of await this.sessions.heldChargeIds())
      if (!(await this.sessions.isOpen(id))) await this.giveBack(id);
  }
}
