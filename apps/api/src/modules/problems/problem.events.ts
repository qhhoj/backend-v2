import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'node:events';

export interface ProblemEventMap {
  pointsChanged: [problemId: string];
  publicityChanged: [problemId: string, suggester: string | null];
  codeRenamed: [oldCode: string, newCode: string];
  statementChanged: [problemId: string];
}

/** In-process notifications for other modules (3b data dir and PDF cache, 2 rescore, 5 webhooks); listeners run synchronously after the write. */
@Injectable()
export class ProblemEvents {
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
    this.emitter.emit(name, ...args);
  }
}
