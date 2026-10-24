import {
  connectivityState,
  credentials,
  Metadata,
  status,
} from '@grpc/grpc-js';
import type {
  ChannelCredentials,
  ClientDuplexStream,
  StatusObject,
} from '@grpc/grpc-js';
import {
  BridgeMessage,
  Case,
  Final,
  Hello,
  JudgeLinkClient,
  JudgeMessage,
  Outcome,
} from '@libs/judge-proto';
import type {
  Assign,
  AssignmentRef,
  GenerationFailure,
  InFlight,
} from '@libs/judge-proto';

export type BridgeBody = NonNullable<BridgeMessage['body']>;
export type BridgeKind = BridgeBody['$case'];
export type BodyOf<Kind extends BridgeKind> = Extract<
  BridgeBody,
  { $case: Kind }
>;
export type JudgeBody = NonNullable<JudgeMessage['body']>;

export interface FakeJudgeOptions {
  name: string;
  key: string;
  slots?: number;
  /** Language keys it reports runtimes for. */
  languages?: string[];
  /** Answer the bridge's pings (default true). */
  answerPings?: boolean;
  /** Features it advertises in Hello (`generate.polygon`). */
  features?: string[];
  /** Runs it claims to still hold (`Hello.inFlight`), for resume. */
  inFlight?: InFlight[];
  /** PEM CA the bridge's certificate is signed by; plaintext without it. */
  ca?: Buffer;
}

const keyOf = (ref: AssignmentRef) => `${ref.submissionId}.${ref.generation}`;

/** A judge-v2 stand-in over real gRPC: records every message the bridge sends, answers pings, numbers each run's messages (seq 1, 2, ...) and sends whatever a test scripts. */
export class FakeJudge {
  readonly received: BridgeMessage[] = [];
  /** Session id from Welcome. */
  sessionId = '';
  status: StatusObject | null = null;
  readonly closed: Promise<StatusObject>;
  private readonly seqs = new Map<string, number>();
  private sentCount = 0;
  private waiters: Array<() => void> = [];
  /** Set by `endSession`: the channel outlives the session. */
  private keepsChannel = false;

  private constructor(
    private readonly client: JudgeLinkClient,
    private readonly call: ClientDuplexStream<JudgeMessage, BridgeMessage>,
    private readonly options: FakeJudgeOptions,
  ) {
    // a resumed run continues after the last seq it sent before the reconnect
    for (const { ref, lastSeqSent } of options.inFlight ?? [])
      if (ref) this.seqs.set(keyOf(ref), lastSeqSent);
    call.on('data', (message: BridgeMessage) => this.onMessage(message));
    call.on('error', () => undefined);
    this.closed = new Promise((resolve) =>
      call.on('status', (ended: StatusObject) => {
        this.status = ended;
        // a judge whose session ended leaves, so its idle socket does not count against the address's unauthenticated cap
        if (!this.keepsChannel) client.close();
        this.wake();
        resolve(ended);
      }),
    );
  }

  /**
   * Opens a Session on a connection of its own and sends nothing (credentials travel as metadata).
   * Never on a socket grpc-js would share between clients: the bridge destroys a socket with no open session a handshake deadline later, so a session opened on a shared idle socket races that destroy and may end UNAVAILABLE.
   */
  static open(port: number, options: FakeJudgeOptions): FakeJudge {
    const client = new JudgeLinkClient(
      `127.0.0.1:${port}`,
      FakeJudge.credentialsOf(options),
      {
        'grpc.ssl_target_name_override': 'localhost',
        'grpc.use_local_subchannel_pool': 1,
      },
    );
    const metadata = new Metadata();
    metadata.set('x-judge-name', options.name);
    metadata.set('x-judge-key', options.key);
    return new FakeJudge(client, client.session(metadata), options);
  }

  /** Opens a Session, says Hello and waits for Welcome. */
  static async online(
    port: number,
    options: FakeJudgeOptions,
  ): Promise<FakeJudge> {
    const judge = FakeJudge.open(port, options);
    judge.hello();
    const welcome = await judge.next('welcome');
    judge.sessionId = welcome.welcome.sessionId;
    return judge;
  }

  private static credentialsOf(options: FakeJudgeOptions): ChannelCredentials {
    return options.ca
      ? credentials.createSsl(options.ca)
      : credentials.createInsecure();
  }

  get isClosed(): boolean {
    return this.status !== null;
  }

  send(body: JudgeBody): void {
    if (this.isClosed) return;
    this.call.write(JudgeMessage.fromPartial({ body }));
    this.sentCount += 1;
  }

  /** Messages written to the stream so far, pongs included. */
  get sent(): number {
    return this.sentCount;
  }

  hello(extra: Partial<Hello> = {}): void {
    const languages = this.options.languages ?? ['CPP17', 'PY3'];
    this.send({
      $case: 'hello',
      hello: Hello.fromPartial({
        protocolMinor: 0,
        build: 'fake-judge',
        slots: this.options.slots ?? 1,
        runtimes: languages.map((languageKey) => ({
          languageKey,
          name: languageKey,
          version: '1',
        })),
        inFlight: this.options.inFlight ?? [],
        features: this.options.features ?? [],
        ...extra,
      }),
    });
  }

  /** Removes and returns the first received message of `kind`, waiting for it. */
  async next<Kind extends BridgeKind>(
    kind: Kind,
    timeoutMs = 5000,
  ): Promise<BodyOf<Kind>> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const index = this.received.findIndex(
        (message) => message.body?.$case === kind,
      );
      if (index >= 0)
        return this.received.splice(index, 1)[0].body as BodyOf<Kind>;
      if (this.isClosed)
        throw new Error(
          `Closed (${this.status?.code}) while waiting for ${kind}`,
        );
      if (Date.now() > deadline)
        throw new Error(`No ${kind} within ${timeoutMs} ms`);
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve);
        setTimeout(resolve, 50);
      });
    }
  }

  /** Removes and returns the first received message that is not a Ping, waiting for it (transcripts follow arrival order). */
  async nextMessage(timeoutMs = 5000): Promise<BridgeMessage> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const index = this.received.findIndex(
        (message) => message.body?.$case !== 'ping',
      );
      if (index >= 0) return this.received.splice(index, 1)[0];
      if (this.isClosed)
        throw new Error(
          `Closed (${this.status?.code}) while waiting for a message`,
        );
      if (Date.now() > deadline)
        throw new Error(`No message within ${timeoutMs} ms`);
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve);
        setTimeout(resolve, 50);
      });
    }
  }

  /** Received messages other than pings, left in place. */
  pending(): BridgeMessage[] {
    return this.received.filter((message) => message.body?.$case !== 'ping');
  }

  async nextAssign(timeoutMs?: number): Promise<Assign> {
    return (await this.next('assign', timeoutMs)).assign;
  }

  /** Removes and returns every received message of `kind`, without waiting. */
  takeAll<Kind extends BridgeKind>(kind: Kind): Array<BodyOf<Kind>> {
    const taken = this.seen(kind);
    const rest = this.received.filter(
      (message) => message.body?.$case !== kind,
    );
    this.received.splice(0, this.received.length, ...rest);
    return taken;
  }

  /** Received messages of `kind`, left in place. */
  seen<Kind extends BridgeKind>(kind: Kind): Array<BodyOf<Kind>> {
    return this.received.flatMap((message) =>
      message.body?.$case === kind ? [message.body as BodyOf<Kind>] : [],
    );
  }

  /** Sends the run's next message with the next seq; returns that seq. */
  accept(ref: AssignmentRef): number {
    return this.sendRun(ref, (seq) => ({
      $case: 'accepted',
      accepted: { ref, seq },
    }));
  }

  compiled(ref: AssignmentRef, log: string): number {
    return this.sendRun(ref, (seq) => ({
      $case: 'compiled',
      compiled: { ref, seq, log },
    }));
  }

  started(ref: AssignmentRef, caseCount = 1, pretested = false): number {
    return this.sendRun(ref, (seq) => ({
      $case: 'started',
      started: { ref, seq, pretested, caseCount },
    }));
  }

  cases(ref: AssignmentRef, cases: Array<Partial<Case>>): number {
    return this.sendRun(ref, (seq) => ({
      $case: 'cases',
      cases: { ref, seq, cases: cases.map((row) => Case.fromPartial(row)) },
    }));
  }

  final(
    ref: AssignmentRef,
    outcome: Outcome,
    extra: Partial<Final> = {},
  ): number {
    return this.sendRun(ref, (seq) => ({
      $case: 'final',
      final: { ...Final.fromPartial(extra), ref, seq, outcome },
    }));
  }

  /** Accepted, GradingStarted, the cases and Final GRADED; resolves when the bridge acked the Final. */
  async grade(ref: AssignmentRef, cases: Array<Partial<Case>>): Promise<void> {
    this.accept(ref);
    this.started(ref, cases.length);
    if (cases.length) this.cases(ref, cases);
    const seq = this.final(ref, Outcome.OUTCOME_GRADED);
    await this.ackOf(ref, seq);
  }

  /** Waits for the ack of `seq` (or a later one) of `ref`. */
  async ackOf(
    ref: AssignmentRef,
    seq: number,
    timeoutMs = 5000,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!this.acked(ref, seq)) {
      if (this.isClosed)
        throw new Error(
          `Closed (${this.status?.code}) before the ack of ${seq}`,
        );
      if (Date.now() > deadline)
        throw new Error(`No ack of seq ${seq} within ${timeoutMs} ms`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  /** The next seq the run's messages would use (for hostile tests that pick their own). */
  nextSeq(ref: AssignmentRef): number {
    return (this.seqs.get(keyOf(ref)) ?? 0) + 1;
  }

  /** FetchSource for `ref` over this judge's credentials. */
  fetchSource(ref: AssignmentRef): Promise<{ code: status; bytes: number }> {
    const stream = this.client.fetchSource(
      { ref, sessionId: this.sessionId },
      this.credentialsMetadata(),
    );
    let bytes = 0;
    stream.on(
      'data',
      (chunk: { data: Buffer }) => (bytes += chunk.data.length),
    );
    stream.on('error', () => undefined);
    return new Promise((resolve) =>
      stream.on('status', (ended: StatusObject) =>
        resolve({ code: ended.code, bytes }),
      ),
    );
  }

  /** FetchGenerationBundle over this judge's credentials: the status and every chunk received, with the biggest chunk's size. */
  fetchGenerationBundle(
    generationId: string,
    sessionId = this.sessionId,
  ): Promise<{ code: status; data: Buffer; biggestChunk: number }> {
    const stream = this.client.fetchGenerationBundle(
      { generationId, sessionId },
      this.credentialsMetadata(),
    );
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: { data: Buffer }) => chunks.push(chunk.data));
    stream.on('error', () => undefined);
    return new Promise((resolve) =>
      stream.on('status', (ended: StatusObject) =>
        resolve({
          code: ended.code,
          data: Buffer.concat(chunks),
          biggestChunk: Math.max(0, ...chunks.map((chunk) => chunk.length)),
        }),
      ),
    );
  }

  /** UploadGeneratedTests: the first message names the generation and session, each chunk carries data. */
  uploadGeneratedTests(
    generationId: string,
    chunks: Buffer[],
    sessionId = this.sessionId,
  ): Promise<{ code: status; bytes: number }> {
    return new Promise((resolve) => {
      const upload = this.client.uploadGeneratedTests(
        this.credentialsMetadata(),
        (error, receipt) =>
          resolve({
            code: error ? error.code : status.OK,
            bytes: Number(receipt?.bytes ?? 0),
          }),
      );
      upload.on('error', () => undefined);
      chunks.forEach((data, index) =>
        upload.write(
          index === 0
            ? { generationId, sessionId, data }
            : { generationId: '', sessionId: '', data },
        ),
      );
      upload.end();
    });
  }

  /** GenerationDone for `generationId`: success, or the failure the judge reports. */
  generationDone(
    generationId: string,
    failure?: Partial<GenerationFailure>,
  ): void {
    this.send({
      $case: 'generationDone',
      generationDone: {
        generationId,
        ok: !failure,
        failure: failure && {
          stage: 0,
          kind: 0,
          program: '',
          testIndex: 0,
          detail: '',
          ...failure,
        },
      },
    });
  }

  /** Ends the stream but keeps the channel, like a judge between two sessions. */
  async endSession(): Promise<StatusObject> {
    this.keepsChannel = true;
    this.call.cancel();
    return this.closed;
  }

  /** True once the channel's connection is gone (the bridge closed the socket), false if it is still up after `timeoutMs`. */
  connectionLost(timeoutMs: number): Promise<boolean> {
    const channel = this.client.getChannel();
    const deadline = Date.now() + timeoutMs;
    return new Promise((resolve) => {
      const watch = () => {
        const state = channel.getConnectivityState(false);
        if (state !== connectivityState.READY) return resolve(true);
        channel.watchConnectivityState(state, deadline, (error) =>
          error ? resolve(false) : watch(),
        );
      };
      watch();
    });
  }

  /** Cancels the session (the connection is lost from the bridge's view) and closes the channel. */
  async close(): Promise<StatusObject> {
    this.call.cancel();
    const ended = await this.closed;
    this.client.close();
    return ended;
  }

  private credentialsMetadata(): Metadata {
    const metadata = new Metadata();
    metadata.set('x-judge-name', this.options.name);
    metadata.set('x-judge-key', this.options.key);
    return metadata;
  }

  private sendRun(
    ref: AssignmentRef,
    body: (seq: number) => JudgeBody,
  ): number {
    const seq = this.nextSeq(ref);
    this.seqs.set(keyOf(ref), seq);
    this.send(body(seq));
    return seq;
  }

  private acked(ref: AssignmentRef, seq: number): boolean {
    return this.seen('ack').some(
      ({ ack }) => ack.ref && keyOf(ack.ref) === keyOf(ref) && ack.seq >= seq,
    );
  }

  private onMessage(message: BridgeMessage): void {
    this.received.push(message);
    const body = message.body;
    if (body?.$case === 'ping' && this.options.answerPings !== false)
      this.send({
        $case: 'pong',
        pong: { nonce: body.ping.nonce, busy: this.seqs.size, load: 0.25 },
      });
    this.wake();
  }

  private wake(): void {
    for (const waiter of this.waiters.splice(0)) waiter();
  }
}
