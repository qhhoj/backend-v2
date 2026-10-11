import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { Injectable, Logger } from '@nestjs/common';
import type { BeforeApplicationShutdown } from '@nestjs/common';
import type { SimilarityError } from '@libs/database';
import { ENGINE_SOURCE } from './similarity-engine.script';
import type { SimilarityFamily } from './similarity-languages';

/**
 * `@dodona/dolos-lib` is ESM-only and loads native tree-sitter addons: Jest and the webpack/CJS build cannot `require` it.
 * A child process also gives a kill switch for a pathological group, which nothing in-process can.
 * `ENGINE_HEAP_MB` caps the V8 heap only; native parser memory is outside it and bounded by the worker container (measured RSS 160 MB at 800 files).
 */
const ENGINE_HEAP_MB = 2048;
export const DEFAULT_MAX_FRAGMENTS_PER_PAIR = 50;
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
/** The child's own deadline is a backstop for a dead worker: it must trail the parent's, which does the killing and the reporting. */
const CHILD_DEADLINE_MARGIN_MS = 5000;
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
  /** Per pair, widest first; defaults to `DEFAULT_MAX_FRAGMENTS_PER_PAIR`. */
  maxFragments?: number;
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
  constructor(
    readonly code: Extract<SimilarityError, 'deadline' | 'engine_failed'>,
  ) {
    super(code);
  }
}

/** The worker is stopping: the comparison was killed or never started. It says nothing about the sources, so it must fail the run, never just one group. */
export class EngineShutdownError extends Error {
  constructor() {
    super('the worker is shutting down');
  }
}

type FailureCode = SimilarityEngineError['code'];

/** Resolved from this package, not the working directory, so the engine works wherever the worker is started. */
const dolosEntryUrl = (): string =>
  pathToFileURL(createRequire(__filename).resolve('@dodona/dolos-lib')).href;

/** The config line, then one line per submission, each serialized only when the writer asks for it. */
function* requestLines(request: EngineRequest): Generator<string> {
  const { family, minSimilarity, maxPairs, timeoutMs } = request;
  const config = {
    dolosEntry: dolosEntryUrl(),
    timeoutMs: timeoutMs + CHILD_DEADLINE_MARGIN_MS,
    language: family.language,
    kgramLength: family.kgramLength,
    kgramsInWindow: family.kgramsInWindow,
    minSimilarity,
    maxPairs,
    maxFragments: request.maxFragments ?? DEFAULT_MAX_FRAGMENTS_PER_PAIR,
  };
  yield JSON.stringify(config);
  for (const submission of request.submissions)
    yield JSON.stringify(submission);
}

const decodePairs = (chunks: Buffer[]): EnginePair[] | null => {
  try {
    const { pairs } = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
      pairs?: EnginePair[];
    };
    return Array.isArray(pairs) ? pairs : null;
  } catch {
    return null;
  }
};

/** One NDJSON line at a time, serialized as it is written and waiting for `drain`, so a big group's sources are never held twice in memory. */
const writeLines = async (child: ChildProcess, lines: Iterable<string>) => {
  for (const line of lines)
    if (!child.stdin!.write(line + '\n')) await once(child.stdin!, 'drain');
  child.stdin!.end();
};

@Injectable()
export class SimilarityEngine implements BeforeApplicationShutdown {
  private readonly logger = new Logger(SimilarityEngine.name);
  /** The worker runs one comparison at a time (queue concurrency 1). */
  protected activeChild: ChildProcess | null = null;
  /** Set once by the shutdown hook: no child may start after it, since nothing would kill that one. */
  private isShuttingDown = false;

  /**
   * The orchestrator kills the worker, not its children. `before…` runs for every module ahead of any `onApplicationShutdown`,
   * so it fires before the BullMQ worker starts waiting for the active job.
   */
  beforeApplicationShutdown(): void {
    this.isShuttingDown = true;
    this.activeChild?.kill('SIGKILL');
  }

  /** Sources must already be prepared (`family.prepare`): the engine is a transport. */
  compare(request: EngineRequest): Promise<EnginePair[]> {
    if (this.isShuttingDown) return Promise.reject(new EngineShutdownError());
    if (request.submissions.length < 2) return Promise.resolve([]);
    return new Promise((resolve, reject) => {
      const child = this.spawnEngine();
      let isSettled = false;
      const settle = (outcome: () => void) => {
        if (isSettled) return;
        isSettled = true;
        clearTimeout(deadline);
        if (this.activeChild === child) this.activeChild = null;
        outcome();
      };
      const fail = (code: FailureCode, detail: string = code) => {
        if (isSettled) return;
        child.kill('SIGKILL');
        this.logger.warn(`similarity engine ${detail}`);
        settle(() => reject(this.failureOf(code)));
      };
      const deadline = setTimeout(() => fail('deadline'), request.timeoutMs);
      const stdout = this.collectStdout(child, () =>
        fail('engine_failed', 'output too large'),
      );
      const stderrTail = this.keepStderrTail(child);
      child.on('error', (error) => fail('engine_failed', error.message));
      child.stdin!.on('error', () => undefined);
      child.on('close', (exitCode, signal) =>
        settle(() => {
          const result = this.exitResult(exitCode, signal, stdout, stderrTail);
          if (result instanceof Error) reject(result);
          else resolve(result);
        }),
      );
      // Anything that throws while feeding the child must still kill it.
      void Promise.resolve()
        .then(() => writeLines(child, requestLines(request)))
        .catch((error: Error) => fail('engine_failed', error.message));
    });
  }

  /** The child's pairs, or why there are none. */
  private exitResult(
    exitCode: number | null,
    signal: NodeJS.Signals | null,
    stdout: Buffer[],
    stderrTail: () => Buffer,
  ): EnginePair[] | Error {
    const pairs = exitCode === 0 ? decodePairs(stdout) : null;
    if (pairs) return pairs;
    this.logger.warn(
      `similarity engine failed (exit ${exitCode}, signal ${signal}): ${stderrTail().toString('utf8')}`,
    );
    return this.failureOf('engine_failed');
  }

  /** A shutdown kill shows up as a closed child or a broken pipe; either way it is reported as the shutdown it is. */
  private failureOf(code: FailureCode): Error {
    return this.isShuttingDown
      ? new EngineShutdownError()
      : new SimilarityEngineError(code);
  }

  private spawnEngine(): ChildProcess {
    const child = spawn(
      process.execPath,
      [
        `--max-old-space-size=${ENGINE_HEAP_MB}`,
        '--input-type=module',
        '-e',
        ENGINE_SOURCE,
      ],
      { stdio: ['pipe', 'pipe', 'pipe', 'ipc'] },
    );
    this.activeChild = child;
    return child;
  }

  /** Chunks are dropped, and `onOverflow` called once, past `MAX_OUTPUT_BYTES`. */
  private collectStdout(child: ChildProcess, onOverflow: () => void): Buffer[] {
    const chunks: Buffer[] = [];
    let received = 0;
    child.stdout!.on('data', (chunk: Buffer) => {
      received += chunk.length;
      if (received <= MAX_OUTPUT_BYTES) chunks.push(chunk);
      else if (received - chunk.length <= MAX_OUTPUT_BYTES) onOverflow();
    });
    return chunks;
  }

  /** Returns a getter for the last `STDERR_TAIL_BYTES` bytes. */
  private keepStderrTail(child: ChildProcess): () => Buffer {
    let tail = Buffer.alloc(0);
    child.stderr!.on('data', (chunk: Buffer) => {
      tail = Buffer.concat([tail, chunk]).subarray(-STDERR_TAIL_BYTES);
    });
    return () => tail;
  }
}
