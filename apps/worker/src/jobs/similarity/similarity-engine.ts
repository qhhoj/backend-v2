import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { Injectable, Logger } from '@nestjs/common';
import type { OnApplicationShutdown } from '@nestjs/common';
import { ENGINE_SOURCE } from './similarity-engine.script';
import type { SimilarityFamily } from './similarity-languages';

/**
 * `@dodona/dolos-lib` is ESM-only and loads native tree-sitter addons: Jest and the webpack/CJS build cannot `require` it.
 * A child process also gives a kill switch for a pathological group, which nothing in-process can.
 * `ENGINE_HEAP_MB` caps the V8 heap only; native parser memory is outside it and bounded by the worker container (measured RSS 160 MB at 800 files).
 */
export const ENGINE_HEAP_MB = 2048;
export const MAX_FRAGMENTS_PER_PAIR = 50;
export const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
const STDERR_TAIL_BYTES = 4 * 1024;

export interface LineRange {
  leftStart: number;
  leftEnd: number;
  rightStart: number;
  rightEnd: number;
}
export interface EngineSubmission {
  id: string;
  user: string;
  source: string;
}
export interface EngineRequest {
  family: SimilarityFamily;
  submissions: EngineSubmission[];
  /** Fraction, 0 to 1: pairs at or above it are kept. */
  minSimilarity: number;
  maxPairs: number;
  timeoutMs: number;
}
export interface EnginePair {
  leftId: string;
  rightId: string;
  similarity: number;
  longest: number;
  overlap: number;
  fragments: LineRange[];
}

/** `code` is safe to show to staff: the child's own output (paths, stack traces) never reaches it, only the log. */
export class SimilarityEngineError extends Error {
  constructor(readonly code: 'deadline' | 'engine_failed') {
    super(code);
  }
}

@Injectable()
export class SimilarityEngine implements OnApplicationShutdown {
  private readonly logger = new Logger(SimilarityEngine.name);
  /** The worker runs one comparison at a time (queue concurrency 1). */
  protected activeChild: ChildProcess | null = null;

  /** The orchestrator kills the worker, not its children: an orphaned engine would keep running for the rest of its deadline. */
  onApplicationShutdown(): void {
    this.activeChild?.kill('SIGKILL');
  }

  /** Sources must already be prepared (`family.prepare`): the engine is a transport. */
  compare(request: EngineRequest): Promise<EnginePair[]> {
    if (request.submissions.length < 2) return Promise.resolve([]);
    return new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          `--max-old-space-size=${ENGINE_HEAP_MB}`,
          '--input-type=module',
          '-e',
          ENGINE_SOURCE,
        ],
        { cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'] },
      );
      this.activeChild = child;
      let settled = false;
      const settle = (outcome: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.activeChild = null;
        outcome();
      };
      const fail = (
        code: SimilarityEngineError['code'],
        detail: string = code,
      ) => {
        child.kill('SIGKILL');
        this.logger.warn(`similarity engine ${detail}`);
        settle(() => reject(new SimilarityEngineError(code)));
      };
      const timer = setTimeout(() => fail('deadline'), request.timeoutMs);
      const chunks: Buffer[] = [];
      let received = 0;
      let stderrTail = '';
      child.stdout.on('data', (chunk: Buffer) => {
        received += chunk.length;
        if (received > MAX_OUTPUT_BYTES)
          fail('engine_failed', 'output too large');
        else chunks.push(chunk);
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderrTail = (stderrTail + chunk.toString('utf8')).slice(
          -STDERR_TAIL_BYTES,
        );
      });
      child.on('error', (error) => fail('engine_failed', error.message));
      // The child may exit before reading everything; its exit code tells the story.
      child.stdin.on('error', () => undefined);
      child.on('close', (exitCode, signal) =>
        settle(() => {
          const output = exitCode === 0 ? parsePairs(chunks) : null;
          if (output) return resolve(output);
          this.logger.warn(
            `similarity engine failed (exit ${exitCode}, signal ${signal}): ${stderrTail}`,
          );
          reject(new SimilarityEngineError('engine_failed'));
        }),
      );
      child.stdin.end(requestLines(request));
    });
  }
}

const requestLines = ({
  family,
  submissions,
  minSimilarity,
  maxPairs,
}: EngineRequest): string => {
  const config = {
    language: family.language,
    kgramLength: family.kgramLength,
    kgramsInWindow: family.kgramsInWindow,
    minSimilarity,
    maxPairs,
    maxFragments: MAX_FRAGMENTS_PER_PAIR,
  };
  return (
    [config, ...submissions].map((line) => JSON.stringify(line)).join('\n') +
    '\n'
  );
};

const parsePairs = (chunks: Buffer[]): EnginePair[] | null => {
  try {
    const { pairs } = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
      pairs?: EnginePair[];
    };
    return Array.isArray(pairs) ? pairs : null;
  } catch {
    return null;
  }
};
