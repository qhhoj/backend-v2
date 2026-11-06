import { Injectable, Logger } from '@nestjs/common';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { UPLOAD_PARTS_SWEEP_MS } from './chunked-upload.limits';
import { HeldCharges } from './held-charges.service';
import { UploadPartsStore } from './upload-parts.store';
import { UploadSessionsStore } from './upload-sessions.store';

/** Ends what sessions that are gone (expired, cancelled, lost with Redis) left behind: settles a charge a crashed complete still holds (`HeldCharges`), then removes the parts. Hourly in every API process, and at each create; both steps are idempotent, so processes never need to agree. */
@Injectable()
export class UploadPartsSweeper implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(UploadPartsSweeper.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly parts: UploadPartsStore,
    private readonly sessions: UploadSessionsStore,
    private readonly charges: HeldCharges,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.sweep(), UPLOAD_PARTS_SWEEP_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  /** Never throws: a failed step is logged and the next sweep tries again. */
  async sweep(): Promise<void> {
    await this.logFailure('Giving back held charges', () =>
      this.charges.settleAbandoned(),
    );
    await this.logFailure('Sweeping chunked upload parts', () =>
      this.parts.sweep((id) => this.sessions.isOpen(id)),
    );
  }

  private async logFailure(
    step: string,
    work: () => Promise<void>,
  ): Promise<void> {
    try {
      await work();
    } catch (error) {
      this.logger.error(`${step} failed: ${(error as Error).message}`);
    }
  }
}
