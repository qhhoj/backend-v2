/**
 * The work of one test generation, built by the worker from a Polygon standard package and sent by the bridge
 * as the proto `GenerateTests` (field for field, camelCase). Stored as `TestGeneration.plan`.
 */
export type GenerationRole = 'GENERATOR' | 'VALIDATOR' | 'SOLUTION';

export interface GenerationProgram {
  /** Unique in the plan; a generator's name is the first token of its tests' commands. */
  name: string;
  role: GenerationRole;
  /** A judge-v2 language key (`CPP17`, `PY3`, ...). */
  languageKey: string;
  /** Path inside the bundle; files in the same bundle directory are copied beside it when compiling. */
  sourcePath: string;
}

/** Exactly one of `manualPath` (an input inside the bundle) or `generator` (+ `args`) is set. */
export interface GenerationTest {
  index: number;
  inputName: string;
  answerName: string;
  group: string;
  manualPath: string;
  generator: string;
  args: string[];
}

export interface ProgramLimits {
  timeS: number;
  wallS: number;
  memoryKib: number;
}

export interface GenerationLimits {
  generator: ProgramLimits;
  validator: ProgramLimits;
  solution: ProgramLimits;
  maxFileBytes: number;
  maxTotalBytes: number;
  maxUploadBytes: number;
}

export interface GenerationPlan {
  deadlineS: number;
  limits: GenerationLimits;
  programs: GenerationProgram[];
  tests: GenerationTest[];
  /** Both set: the solution reads and writes these files (problem.xml input-file / output-file). */
  inputFile: string;
  outputFile: string;
}

/** The judge feature a judge advertises in Hello when it runs generations. */
export const GENERATE_FEATURE = 'generate.polygon';
