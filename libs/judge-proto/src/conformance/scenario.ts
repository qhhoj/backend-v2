import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parse } from 'yaml';
import { BridgeMessage, JudgeMessage } from '../generated/qhhoj/judge/v1/judge';
import { PROTO_ROOT } from '../proto-root';
import { expand } from './expand';
import type { Bindings } from './expand';
import { mismatch } from './matcher';
import type { Json } from './matcher';

/** Mirrors judge-v2 `crates/conformance/src/scenario.rs`: a wire transcript; `judge` steps travel judge -> bridge, `bridge` steps bridge -> judge. */
export type Role = 'bridge' | 'judge';
export type JsonObject = { [key: string]: Json };
export type ApiAction =
  | { judge: string[] }
  | { abort: string }
  | { rejudge: string }
  | { block: string }
  | { rotate_key: string }
  | { disable: string };

export type Step =
  | { open: { judge: string; wrong_key?: boolean; expect?: string } }
  | { judge: { from: string; message: JsonObject; repeat?: number } }
  | { bridge: { to: string; message: JsonObject } }
  | { quiet: { to: string; ms: number } }
  | { closed: { judge: string; status: string } }
  | { drop: { judge: string } }
  | {
      fetch: { judge: string; ref: JsonObject; expect: string; bytes?: number };
    }
  | { api: ApiAction }
  | { wait: { ms: number } }
  | { restart_bridge: Record<string, never> };

export interface ScenarioSetup {
  judges: Array<{
    name: string;
    blocked?: boolean;
    /** A second connection authenticating as this judge, addressed by `name`. */
    as?: string;
    /** False: the judge ignores pings (a hung process). */
    answers_pings?: boolean;
  }>;
  problems?: Array<{ code: string; dataVersion?: number; partial?: boolean }>;
  submissions?: Array<{
    id: string;
    problem: string;
    language?: string;
    fileBytes?: number;
  }>;
}

export interface Scenario {
  name: string;
  summary: string;
  applies_to: Role[];
  /** Bridge timing overrides in ms (`handshakeMs`, `acceptMs`, `resumeGraceMs`, `resyncMs`, `idleMs`, ...). */
  timings?: Record<string, number>;
  setup: ScenarioSetup;
  steps: Step[];
  /** Mongo state after the last step: `submissions.<placeholder>`, `judges.<name>`, `gradedJobs`. */
  end_state?: JsonObject;
}

const STEP_KINDS = [
  'open',
  'judge',
  'bridge',
  'quiet',
  'closed',
  'drop',
  'fetch',
  'api',
  'wait',
  'restart_bridge',
] as const;
export type StepKind = (typeof STEP_KINDS)[number];

export const SCENARIOS_DIR = join(PROTO_ROOT, 'conformance', 'scenarios');

/** The step's one key. */
export function kindOf(step: Step): StepKind {
  const keys = Object.keys(step);
  const kind = keys[0] as StepKind;
  if (keys.length !== 1 || !STEP_KINDS.includes(kind))
    throw new Error(
      `a step has exactly one of ${STEP_KINDS.join(', ')}: ${keys.join(', ')}`,
    );
  return kind;
}

/** Fixed sample ids for validation; runners bind real ones. */
export function sampleBindings(scenario: Scenario): Bindings {
  const bindings = new Map<string, string>();
  (scenario.setup.submissions ?? []).forEach((submission, index) =>
    bindings.set(
      submission.id,
      `01920000-0000-7000-8000-${String(index + 1).padStart(12, '0')}`,
    ),
  );
  for (const judge of scenario.setup.judges)
    bindings.set(`session:${judge.name}`, `session-of-${judge.name}`);
  return bindings;
}

/** ts-proto's `fromJSON` ignores unknown keys, so a message is valid only when it survives a round trip. */
function checkMessage(
  message: JsonObject,
  bindings: Bindings,
  codec: typeof JudgeMessage | typeof BridgeMessage,
): void {
  const expanded = expand(message, bindings);
  const echoed = codec.toJSON(codec.fromJSON(expanded) as never) as Json;
  const lost = mismatch(expanded, echoed);
  if (lost)
    throw new Error(
      `not a ${codec === JudgeMessage ? 'JudgeMessage' : 'BridgeMessage'}: ${lost}`,
    );
}

function checkStep(
  step: Step,
  known: (judge: string) => void,
  bindings: Bindings,
): void {
  kindOf(step);
  if ('open' in step) return known(step.open.judge);
  if ('judge' in step) {
    known(step.judge.from);
    return checkMessage(step.judge.message, bindings, JudgeMessage);
  }
  if ('bridge' in step) {
    known(step.bridge.to);
    return checkMessage(step.bridge.message, bindings, BridgeMessage);
  }
  if ('quiet' in step) return known(step.quiet.to);
  if ('closed' in step) return known(step.closed.judge);
  if ('drop' in step) return known(step.drop.judge);
  if ('fetch' in step) {
    known(step.fetch.judge);
    expand(step.fetch.ref, bindings);
  }
}

function checkJudges(judges: ScenarioSetup['judges']): void {
  const names = new Set(judges.map((judge) => judge.name));
  for (const judge of judges) {
    if (
      judge.as !== undefined &&
      (judge.as === judge.name || !names.has(judge.as))
    )
      throw new Error(
        `judge ${judge.name}: as ${judge.as} must name another judge`,
      );
  }
}

export function validateScenario(scenario: Scenario, fileStem: string): void {
  if (scenario.name !== fileStem)
    throw new Error(`name ${scenario.name} must equal the file name`);
  if (!scenario.applies_to?.length) throw new Error('applies_to is empty');
  const restarts = scenario.steps.some(
    (step) => kindOf(step) === 'restart_bridge',
  );
  if (restarts && scenario.applies_to.join() !== 'bridge')
    throw new Error('restart_bridge needs applies_to: [bridge]');
  const judges = new Set(scenario.setup.judges.map((judge) => judge.name));
  checkJudges(scenario.setup.judges);
  const known = (judge: string) => {
    if (!judges.has(judge)) throw new Error(`unknown judge ${judge}`);
  };
  const bindings = sampleBindings(scenario);
  scenario.steps.forEach((step, index) => {
    try {
      checkStep(step, known, bindings);
    } catch (error) {
      throw new Error(`step ${index + 1}: ${(error as Error).message}`);
    }
  });
}

export function loadScenario(path: string): Scenario {
  const scenario = parse(readFileSync(path, 'utf8')) as Scenario;
  try {
    validateScenario(scenario, basename(path, '.yaml'));
  } catch (error) {
    throw new Error(`${path}: ${(error as Error).message}`);
  }
  return scenario;
}

/** Every `*.yaml` scenario in `dir`, sorted by file name. */
export const loadScenarios = (dir: string = SCENARIOS_DIR): Scenario[] =>
  readdirSync(dir)
    .filter((file) => file.endsWith('.yaml'))
    .sort()
    .map((file) => loadScenario(join(dir, file)));
