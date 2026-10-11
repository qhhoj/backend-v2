export class RuntimeJudgeResponse {
  /** Judge name. */
  name!: string;
  /** Whether the judge is connected now. */
  online!: boolean;
  /** Assignments it runs at once. */
  slots!: number;
  /** Slots in use at its last pong; 0 while offline. */
  busy!: number;
  /** Milliseconds, mean of the last 6 pings; null while offline or unmeasured. */
  pingMs!: number | null;
  /** When the judge process last started; null if it never connected. Meaningful while online. */
  startedAt!: Date | null;
}

export class RuntimeVersionResponse {
  /** Name of the judge that has this runtime. */
  judge!: string;
  /** Compiler or interpreter name. */
  compiler!: string;
  /** Runtime version. */
  version!: string;
}

export class RuntimeLanguageResponse {
  /** Language key judges report. */
  key!: string;
  /** Display name. */
  name!: string;
  /** Generic family name, shared by versions. */
  commonName!: string;
  /** File extension without the dot. */
  extension!: string;
  /** Whether solutions are uploaded as a file instead of typed. */
  fileOnly!: boolean;
  /** One entry per listed judge, online or not, that has the language. */
  versions!: RuntimeVersionResponse[];
}

export class RuntimesResponse {
  /** Judges that may connect, by name. */
  judges!: RuntimeJudgeResponse[];
  /** Every programming language, by name. */
  languages!: RuntimeLanguageResponse[];
}
