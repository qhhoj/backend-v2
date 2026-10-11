import { uuidStr } from '@libs/database';
import type { JudgeListRow } from '../judges.repository';

export class JudgeRuntimeResponse {
  /** Language key the runtime serves. */
  language!: string;
  /** Compiler or interpreter name. */
  name!: string;
  /** Runtime version. */
  version!: string;
  /** Preference among runtimes of the same language; higher is tried first. */
  priority!: number;
}

export class JudgeAddressResponse {
  /** IP address it connected from. */
  ip!: string;
  /** First connection from it. */
  firstSeen!: Date;
  /** Latest connection from it. */
  lastSeen!: Date;
  /** Sessions opened from it. */
  connections!: number;
}

export class JudgeResponse {
  /** Judge id. */
  id!: string;
  /** Unique judge name. */
  name!: string;
  /** Free-form notes. */
  description!: string;
  /** Whether the judge is connected now. */
  online!: boolean;
  /** Whether the judge is refused. */
  isBlocked!: boolean;
  /** Why staff blocked it; empty when not blocked or no reason was given. */
  blockReason!: string;
  /** Whether the judge is told to take no new work. */
  isDisabled!: boolean;
  /** When the judge process last started; null if it never connected. */
  startTime!: Date | null;
  /** Seconds, mean of the last 6 pings. */
  ping!: number | null;
  /** Load reported by the judge; null if never reported. */
  load!: number | null;
  /** IP address of the last connection; null if it never connected. */
  lastIp!: string | null;
  /** Addresses it connected from, most recently seen first; at most 20. */
  ipHistory!: JudgeAddressResponse[];
  /** Languages the judge can run. */
  runtimes!: JudgeRuntimeResponse[];
  /** Assignments it runs at once. */
  slots!: number;
  /** Slots in use at its last pong; 0 while offline. */
  busy!: number;
  /** Judge software build identifier. */
  build!: string;
  /** Minor version of the judge protocol it speaks. */
  protocolMinor!: number;
  /** Optional protocol features the judge supports. */
  features!: string[];

  static from(judge: JudgeListRow): JudgeResponse {
    return {
      id: uuidStr(judge._id),
      name: judge.name,
      description: judge.description,
      online: judge.online,
      isBlocked: judge.isBlocked,
      blockReason: judge.blockReason ?? '',
      isDisabled: judge.isDisabled,
      startTime: judge.startTime,
      ping: judge.ping,
      load: judge.load,
      lastIp: judge.lastIp,
      // rows from before the field are read through `aggregate`, so no schema default fills it
      ipHistory: (judge.ipHistory ?? [])
        .map(({ ip, firstSeen, lastSeen, connections }) => ({
          ip,
          firstSeen,
          lastSeen,
          connections,
        }))
        .sort(
          (left, right) => right.lastSeen.getTime() - left.lastSeen.getTime(),
        ),
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
  /** The registered judge. */
  judge!: JudgeResponse;
  /** Shown once; only its sha256 is stored. */
  authKey!: string;
}

export class JudgeKeyResponse {
  /** The new authentication key, shown only this once; only its hash is stored. */
  authKey!: string;
}
