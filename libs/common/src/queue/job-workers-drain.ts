import { WorkerHost } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { BeforeApplicationShutdown } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import type { Worker } from 'bullmq';

/**
 * Shutdown order is declared by Nest's phases, not by module position (Nest ties every global module and falls back
 * to the order it inserted them):
 * 1. `onModuleDestroy`: work stops arriving (event streams, the judge link, child processes);
 * 2. `beforeApplicationShutdown`: every BullMQ worker finishes its running job (here);
 * 3. the HTTP server closes (its `onClose` hooks still write);
 * 4. `onApplicationShutdown`: the shared connections close (`REDIS`, Mongo), which running jobs used until step 2.
 */
@Injectable()
export class JobWorkersDrain implements BeforeApplicationShutdown {
  constructor(private readonly discovery: DiscoveryService) {}

  async beforeApplicationShutdown(): Promise<void> {
    await Promise.all(this.workers().map((worker) => worker.close()));
  }

  private workers(): Worker[] {
    const workers: Worker[] = [];
    for (const { instance } of this.discovery.getProviders()) {
      const host: unknown = instance;
      if (!(host instanceof WorkerHost)) continue;
      try {
        workers.push((host as WorkerHost<Worker>).worker);
      } catch {
        // never registered: the app closed before it initialised
      }
    }
    return workers;
  }
}
