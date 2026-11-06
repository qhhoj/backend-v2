import { Injectable, Logger } from '@nestjs/common';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { UPLOAD_PARTS_SWEEP_MS } from './chunked-upload.limits';
import { UploadPartsStore } from './upload-parts.store';
import { UploadSessionsStore } from './upload-sessions.store';

/** Removes the parts of sessions that are gone (expired, cancelled, lost with Redis): hourly in every API process, and at each create. Removals are idempotent, so processes never need to agree. */
@Injectable()
export class UploadPartsSweeper implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(UploadPartsSweeper.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly parts: UploadPartsStore,
    private readonly sessions: UploadSessionsStore,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.sweep(), UPLOAD_PARTS_SWEEP_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  /** Never throws: a failed sweep is logged and the next one tries again. */
  async sweep(): Promise<void> {
    try {
      await this.parts.sweep((id) => this.sessions.isOpen(id));
    } catch (error) {
      this.logger.error(
        `Sweeping chunked upload parts failed: ${(error as Error).message}`,
      );
    }
  }
}
