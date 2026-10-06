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
  problemCount!: number;
  runtimes!: JudgeRuntimeResponse[];

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
      problemCount: judge.problemCount,
      runtimes: judge.runtimes.map(({ language, name, version, priority }) => ({
        language,
        name,
        version,
        priority,
      })),
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
