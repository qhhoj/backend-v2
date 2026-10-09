import { uuidStr } from '@libs/database';
import type { JudgeListRow } from '../judges.repository';

export class JudgeRuntimeResponse {
  language!: string;
  name!: string;
  version!: string;
  priority!: number;
}

export class JudgeResponse {
  id!: string;
  name!: string;
  description!: string;
  online!: boolean;
  isBlocked!: boolean;
  isDisabled!: boolean;
  startTime!: Date | null;
  /** Seconds, mean of the last 6 pings. */
  ping!: number | null;
  load!: number | null;
  lastIp!: string | null;
  runtimes!: JudgeRuntimeResponse[];
  /** Assignments it runs at once. */
  slots!: number;
  /** Slots in use at its last pong; 0 while offline. */
  busy!: number;
  build!: string;
  protocolMinor!: number;
  features!: string[];

  static from(judge: JudgeListRow): JudgeResponse {
    return {
      id: uuidStr(judge._id),
      name: judge.name,
      description: judge.description,
      online: judge.online,
      isBlocked: judge.isBlocked,
      isDisabled: judge.isDisabled,
      startTime: judge.startTime,
      ping: judge.ping,
      load: judge.load,
      lastIp: judge.lastIp,
      runtimes: judge.runtimes.map(({ language, name, version, priority }) => ({
        language,
        name,
        version,
        priority,
      })),
      slots: judge.slots,
      busy: judge.busy,
      build: judge.build,
      protocolMinor: judge.protocolMinor,
      features: judge.features,
    };
  }
}

export class CreatedJudgeResponse {
  judge!: JudgeResponse;
  /** Shown once; only its sha256 is stored. */
  authKey!: string;
}

export class JudgeKeyResponse {
  authKey!: string;
}
