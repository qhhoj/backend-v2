import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter } from 'node:events';

export interface ProblemEventMap {
  pointsChanged: [problemId: string];
  publicityChanged: [problemId: string, suggester: string | null];
  codeRenamed: [oldCode: string, newCode: string];
  statementChanged: [problemId: string];
}

/** In-process notifications for other modules (3b data dir and PDF cache, 2 rescore, 5 webhooks); listeners run synchronously after the write, and a throwing listener is logged without failing the write or skipping the others. */
@Injectable()
export class ProblemEvents {
  private readonly logger = new Logger(ProblemEvents.name);
  private readonly emitter = new EventEmitter();

  on<Name extends keyof ProblemEventMap>(
    name: Name,
    listener: (...args: ProblemEventMap[Name]) => void,
  ): void {
    this.emitter.on(name, listener);
  }

  emit<Name extends keyof ProblemEventMap>(
    name: Name,
    ...args: ProblemEventMap[Name]
  ): void {
    for (const listener of this.emitter.listeners(name) as Array<
      (...listenerArgs: ProblemEventMap[Name]) => void
    >) {
      try {
        listener(...args);
      } catch (error) {
        this.logger.error(`Listener of "${name}" failed`, error);
      }
    }
  }
}
