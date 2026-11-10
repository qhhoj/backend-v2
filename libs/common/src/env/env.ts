import type { ConfigPart } from './config-parts';
import { EnvReader } from './env-reader';
import type { EnvSource } from './env-reader';

/** The loaded config of the running process (`EnvModule.forRoot`); a consumer types it as the parts it reads. */
export const ENV = Symbol('ENV');

/**
 * The fixed values of the running process, declared once at its root (`EnvModule.forRoot`'s second argument): limits,
 * costs and outbound clients production never varies and specs replace (`setupApiTest({ tuning })`). Never read from
 * the environment. A consumer types it as the part it reads, as with `ENV`.
 */
export const TUNING = Symbol('TUNING');

type IntersectionOf<Union> = (
  Union extends unknown ? (value: Union) => void : never
) extends (value: infer Intersection) => void
  ? Intersection
  : never;

type PartConfig<Part> = Part extends ConfigPart<infer Config> ? Config : never;

/** What a process declares: its parts, and the loader that reads them. */
export interface ProcessConfig<Config> {
  load(source?: EnvSource): Config;
}

export type ConfigOf<Process> =
  Process extends ProcessConfig<infer Config> ? Config : never;

/**
 * A process's config from its parts. `load` reads only the variables those parts name and ignores every other one,
 * so one env file serves all three processes. It reports every problem at once: read problems, then each part's check.
 */
export function processConfig<Parts extends ConfigPart<object>[]>(
  ...parts: Parts
): ProcessConfig<IntersectionOf<PartConfig<Parts[number]>>> {
  return {
    load(source = process.env) {
      const reader = new EnvReader(source);
      const config = parts.reduce<object>(
        (read, part) => ({ ...read, ...part.read(reader) }),
        {},
      );
      const problems = [
        ...reader.problems,
        ...parts.flatMap((part) => part.check?.(config) ?? []),
      ];
      if (problems.length)
        throw new Error(`Invalid environment: ${problems.join('; ')}`);
      return config as IntersectionOf<PartConfig<Parts[number]>>;
    },
  };
}
