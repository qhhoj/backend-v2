import { randomBytes } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import Redis from 'ioredis';
import { TEST_REDIS_URL } from '@libs/common/testing';
import { BridgeCommandsService } from '@libs/judging';
import { MAX_PACKETS_PER_SECOND } from '../src/judges/judge.handler';
import { MAX_UNAUTHENTICATED_PER_ADDRESS } from '../src/judges/judge-server.service';
import { encodePacket } from '../src/protocol/packet-codec';
import { FakeJudge, frameOf } from './fake-judge';
import {
  seedCatalog,
  seedJudge,
  seedProblem,
  seedSubmission,
  waitUntil,
} from './fixtures';
import type { BridgeCatalog } from './fixtures';
import { setupBridgeTest } from './setup';
import type { BridgeTest } from './setup';

const KEY = 'correct horse battery staple';
const HANDSHAKE_MS = 3000;
/** Only a header: a frame announcing `size` body bytes. */
const announcing = (size: number): Buffer => {
  const header = Buffer.alloc(4);
  header.writeUInt32BE(size);
  return header;
};

describe('Judge connections', () => {
  let bridge: BridgeTest;
  let catalog: BridgeCatalog;
  let port: number;
  const redis = new Redis(TEST_REDIS_URL);
  const commands = new BridgeCommandsService(redis);
  let names = 0;
  /** A registered judge name and a problem only it supports, unique per test. */
  const fresh = async (fields: Parameters<typeof seedJudge>[3] = {}) => {
    names += 1;
    const name = `judge-${names}`;
    await seedJudge(bridge, name, KEY, fields);
    const problem = await seedProblem(bridge, catalog, { code: `j${names}` });
    return { name, problem };
  };
  const judgeRow = async (name: string) =>
    (await bridge.judges.findOne({ name }).lean())!;
  const submissionRow = async (id: string) =>
    (await bridge.submissions.findById(id).lean())!;
  const queue = async (problemId: string, fields: object = {}) => {
    const { _id } = await seedSubmission(bridge, catalog, {
      problem: problemId,
      ...fields,
    });
    await commands.judge([_id]);
    return _id;
  };
  const caseOf = (position: number, extra: object = {}) => ({
    position,
    status: 0,
    time: 0.01 * position,
    memory: 1024,
    points: 1,
    'total-points': 1,
    feedback: '',
    'extended-feedback': '',
    output: '',
    ...extra,
  });

  beforeAll(async () => {
    bridge = await setupBridgeTest({ timings: { handshakeMs: HANDSHAKE_MS } });
    catalog = await seedCatalog(bridge);
    port = bridge.judgePort();
  });
  afterAll(async () => {
    await redis.quit();
    await bridge.teardown();
  });

  describe('handshake and liveness', () => {
    it('records an authenticated judge online with its problems, runtimes, address and load', async () => {
      const { name, problem } = await fresh();
      const judge = await FakeJudge.online(port, {
        name,
        key: KEY,
        problems: [problem.code],
      });
      await waitUntil(async () => (await judgeRow(name)).load !== null);
      expect(await judgeRow(name)).toMatchObject({
        online: true,
        problems: [problem.code],
        runtimes: [
          { language: 'CPP17', name: 'g++', version: '11.4', priority: 0 },
          { language: 'PY3', name: 'python', version: '3.12', priority: 0 },
        ],
        lastIp: '127.0.0.1',
        load: 0.25,
      });
      expect((await judgeRow(name)).ping).toBeGreaterThanOrEqual(0);
      await judge.close();
      await waitUntil(async () => !(await judgeRow(name)).online);
      expect(await judgeRow(name)).toMatchObject({ runtimes: [], ping: null });
    });

    it.each([
      ['a wrong key', 'wrong key', {}],
      ['an unknown name', KEY, { unknown: true }],
      ['a blocked judge', KEY, { isBlocked: true }],
    ])(
      'closes the connection for %s without a handshake success',
      async (_label, key, flags) => {
        const { unknown, ...fields } = flags as {
          unknown?: boolean;
          isBlocked?: boolean;
        };
        const { name } = await fresh(fields);
        const judge = await FakeJudge.connect(port);
        judge.send({
          name: 'handshake',
          id: unknown ? `${name}-ghost` : name,
          key,
          problems: [],
          executors: {},
        });
        await judge.closed;
        expect(judge.received.map((packet) => packet.name)).not.toContain(
          'handshake-success',
        );
        expect((await judgeRow(name)).online).toBe(false);
      },
    );

    it('closes a connection that trickles bytes but never completes the handshake', async () => {
      const { name } = await fresh();
      const frame = encodePacket({
        name: 'handshake',
        id: name,
        key: KEY,
        problems: [],
        executors: {},
      });
      const judge = await FakeJudge.connect(port);
      const started = Date.now();
      let sent = 0;
      const trickle = setInterval(() => {
        if (sent >= frame.length - 1) return;
        judge.write(frame.subarray(sent, sent + 1));
        sent += 1;
      }, 100);
      await judge.closed;
      clearInterval(trickle);
      expect(sent).toBeLessThan(frame.length - 1);
      expect(Date.now() - started).toBeGreaterThanOrEqual(HANDSHAKE_MS - 100);
      expect((await judgeRow(name)).online).toBe(false);
    });

    it.each([
      [
        'a submission packet before the handshake',
        encodePacket({ name: 'grading-end', 'submission-id': 'x' }),
      ],
      [
        'a ping-response before the handshake',
        encodePacket({ name: 'ping-response', when: 0, load: 0 }),
      ],
      ['a 5 MiB header before the handshake', announcing(5 * 1024 * 1024)],
      ['a header announcing more than 8 MiB', announcing(0xffffffff)],
      ['a body that is not zlib', frameOf(Buffer.from('not zlib at all'))],
      ['invalid UTF-8', frameOf(deflateSync(Buffer.from([0x7b, 0xff, 0x7d])))],
      ['non-JSON', frameOf(deflateSync(Buffer.from('{name')))],
    ])('closes at once on %s', async (_label, bytes) => {
      const judge = await FakeJudge.connect(port);
      const started = Date.now();
      judge.write(bytes);
      await judge.closed;
      expect(Date.now() - started).toBeLessThan(HANDSHAKE_MS / 2);
    });

    it('closes an authenticated judge that floods packets that need no database write', async () => {
      const { name, problem } = await fresh();
      const flood = await FakeJudge.online(port, {
        name,
        key: KEY,
        problems: [problem.code],
      });
      const id = await queue(problem._id);
      await flood.next('submission-request');
      flood.send({ name: 'submission-acknowledged', 'submission-id': id });
      flood.write(
        Buffer.concat(
          Array.from({ length: 2 * MAX_PACKETS_PER_SECOND }, () =>
            encodePacket({ name: 'batch-end', 'submission-id': id }),
          ),
        ),
      );
      await flood.closed;
    });

    it('closes an authenticated judge that handshakes twice', async () => {
      const { name } = await fresh();
      const twice = await FakeJudge.online(port, { name, key: KEY });
      twice.send({
        name: 'handshake',
        id: name,
        key: KEY,
        problems: [],
        executors: {},
      });
      await twice.closed;
    });

    it('refuses the ninth unauthenticated connection from one address at once', async () => {
      const held = await Promise.all(
        Array.from({ length: MAX_UNAUTHENTICATED_PER_ADDRESS }, () =>
          FakeJudge.connect(port),
        ),
      );
      const started = Date.now();
      const ninth = await FakeJudge.connect(port);
      await ninth.closed;
      expect(Date.now() - started).toBeLessThan(HANDSHAKE_MS / 2);
      expect(held.some((judge) => judge.isClosed)).toBe(false);
      await Promise.all(held.map((judge) => judge.close()));
    });

    it('does not count authenticated judges against the unauthenticated cap', async () => {
      const judges = [];
      for (let index = 0; index <= MAX_UNAUTHENTICATED_PER_ADDRESS; index++) {
        const { name } = await fresh();
        judges.push(await FakeJudge.online(port, { name, key: KEY }));
      }
      expect(judges.some((judge) => judge.isClosed)).toBe(false);
      await Promise.all(judges.map((judge) => judge.close()));
    });

    it('closes a judge that falls silent', async () => {
      const { name } = await fresh();
      const silent = await FakeJudge.online(port, {
        name,
        key: KEY,
        answerPings: false,
      });
      await silent.closed;
      await waitUntil(async () => !(await judgeRow(name)).online);
    });

    it('keeps the judge online when its replaced connection closes', async () => {
      const { name } = await fresh();
      const first = await FakeJudge.online(port, { name, key: KEY });
      const second = await FakeJudge.online(port, { name, key: KEY });
      await first.closed;
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect((await judgeRow(name)).online).toBe(true);
      second.received.length = 0;
      await second.next('ping');
      await second.close();
    });

    it('decodes a large packet trickled in small chunks', async () => {
      const { name, problem } = await fresh();
      const judge = await FakeJudge.online(port, {
        name,
        key: KEY,
        problems: [problem.code],
        answerPings: false, // a ping reply written mid-trickle would interleave with the frame
      });
      const id = await queue(problem._id);
      await judge.next('submission-request');
      judge.send({ name: 'submission-acknowledged', 'submission-id': id });
      const log = randomBytes(30_000).toString('hex');
      const frame = encodePacket({
        name: 'compile-message',
        'submission-id': id,
        log,
      });
      expect(frame.length).toBeGreaterThan(20_000);
      for (let sent = 0; sent < frame.length; sent += 50) {
        judge.write(frame.subarray(sent, sent + 50));
        await new Promise((resolve) => setImmediate(resolve));
      }
      expect(judge.isClosed).toBe(false);
      await waitUntil(async () => (await submissionRow(id)).error === log);
      expect(judge.isClosed).toBe(false);
      await judge.close();
    });

    it('takes work for problems it reports later', async () => {
      const { name, problem } = await fresh();
      const judge = await FakeJudge.online(port, { name, key: KEY });
      const id = await queue(problem._id);
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(judge.received.map((packet) => packet.name)).not.toContain(
        'submission-request',
      );
      judge.send({ name: 'supported-problems', problems: [[problem.code, 0]] });
      expect((await judge.next('submission-request'))['submission-id']).toBe(
        id,
      );
      await waitUntil(async () =>
        (await judgeRow(name)).problems.includes(problem.code),
      );
      await judge.close();
    });
  });

  describe('grading', () => {
    it('judges a submission end to end, batches included, then takes the next one', async () => {
      const { name, problem } = await fresh();
      await bridge.problems.updateOne(
        { _id: problem._id },
        {
          $set: {
            points: 100,
            partial: true,
            timeLimit: 3,
            memoryLimit: 131072,
          },
        },
      );
      const judge = await FakeJudge.online(port, {
        name,
        key: KEY,
        problems: [problem.code],
      });
      const id = await queue(problem._id);
      const next = await queue(problem._id);
      const request = await judge.next('submission-request');
      expect(request).toEqual({
        name: 'submission-request',
        'submission-id': id,
        'problem-id': problem.code,
        language: 'CPP17',
        source: 'int main() {}',
        'time-limit': 3,
        'memory-limit': 131072,
        'short-circuit': false,
        meta: {
          'pretests-only': false,
          'in-contest': null,
          'attempt-no': 1,
          user: catalog.user._id,
          'file-only': false,
          'file-size-limit': 0,
        },
      });
      for (const packet of [
        { name: 'submission-acknowledged' },
        { name: 'grading-begin', pretested: false },
        { name: 'batch-begin' },
        {
          name: 'test-case-status',
          cases: [caseOf(1), caseOf(2, { status: 1, points: 0 })],
        },
        { name: 'batch-end' },
        { name: 'test-case-status', cases: [caseOf(3)] },
        { name: 'grading-end' },
      ])
        judge.send({ ...packet, 'submission-id': id });
      expect((await judge.next('submission-request'))['submission-id']).toBe(
        next,
      );
      await waitUntil(async () => (await submissionRow(id)).status === 'D');
      expect(await submissionRow(id)).toMatchObject({
        result: 'WA',
        batch: true,
        casePoints: 1,
        caseTotal: 2,
        points: 50,
        judgedOn: name,
      });
      expect(
        (await bridge.gradedJobs()).map((job) => job.submissionId),
      ).toContain(id);
      await judge.close();
    });

    it('grades a submission of 40 one-case batches sent as fast as a real judge does', async () => {
      const { name, problem } = await fresh();
      const judge = await FakeJudge.online(port, {
        name,
        key: KEY,
        problems: [problem.code],
      });
      const id = await queue(problem._id);
      await judge.next('submission-request');
      const send = (packet: object) =>
        judge.send({ ...packet, 'submission-id': id } as never);
      send({ name: 'submission-acknowledged' });
      send({ name: 'grading-begin', pretested: false });
      for (let position = 1; position <= 40; position++) {
        send({ name: 'batch-begin' });
        send({ name: 'test-case-status', cases: [caseOf(position)] });
        send({ name: 'batch-end' });
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      send({ name: 'grading-end' });
      await waitUntil(async () => (await submissionRow(id)).status === 'D');
      expect(await submissionRow(id)).toMatchObject({
        result: 'AC',
        requeueCount: 0,
      });
      await judge.close();
    });

    it('ignores a packet for another submission: nothing is written and the connection stays', async () => {
      const { name, problem } = await fresh();
      const other = (
        await seedSubmission(bridge, catalog, { problem: problem._id })
      )._id;
      const judge = await FakeJudge.online(port, {
        name,
        key: KEY,
        problems: [problem.code],
      });
      const id = await queue(problem._id);
      await judge.next('submission-request');
      judge.send({ name: 'submission-acknowledged', 'submission-id': id });
      judge.send({
        name: 'grading-begin',
        'submission-id': id,
        pretested: false,
      });
      judge.send({ name: 'grading-end', 'submission-id': other });
      judge.send({ name: 'compile-error', 'submission-id': other, log: 'x' });
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(judge.isClosed).toBe(false);
      expect(await submissionRow(id)).toMatchObject({ status: 'G' });
      expect(await submissionRow(other)).toMatchObject({
        status: 'QU',
        judgedOn: null,
      });
      await judge.close();
    });

    it('answers an acknowledgement of another submission with IE on its own and closes', async () => {
      const { name, problem } = await fresh();
      const other = (
        await seedSubmission(bridge, catalog, { problem: problem._id })
      )._id;
      const judge = await FakeJudge.online(port, {
        name,
        key: KEY,
        problems: [problem.code],
      });
      const id = await queue(problem._id);
      await judge.next('submission-request');
      judge.send({ name: 'submission-acknowledged', 'submission-id': other });
      await judge.closed;
      await waitUntil(async () => (await submissionRow(id)).status === 'IE');
      expect(await submissionRow(other)).toMatchObject({
        status: 'QU',
        judgedOn: null,
      });
    });

    it('ignores the old run tail (grading-end, cases, batches) until grading-begin, then grades normally', async () => {
      const { name, problem } = await fresh();
      const judge = await FakeJudge.online(port, {
        name,
        key: KEY,
        problems: [problem.code],
      });
      const id = await queue(problem._id);
      await judge.next('submission-request');
      const send = (packet: object) =>
        judge.send({ ...packet, 'submission-id': id } as never);
      send({ name: 'submission-acknowledged' });
      send({ name: 'batch-begin' });
      send({ name: 'test-case-status', cases: [caseOf(1)] });
      send({ name: 'batch-end' });
      send({ name: 'grading-end' });
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(judge.isClosed).toBe(false);
      expect(await submissionRow(id)).toMatchObject({
        status: 'P',
        batch: false,
      });
      expect(
        (await bridge.submissions.findById(id).select('+cases').lean())!.cases,
      ).toEqual([]);
      send({ name: 'grading-begin', pretested: false });
      send({ name: 'test-case-status', cases: [caseOf(1)] });
      send({ name: 'grading-end' });
      await waitUntil(async () => (await submissionRow(id)).status === 'D');
      expect(await submissionRow(id)).toMatchObject({ caseTotal: 1 });
      await judge.close();
    });

    it('still accepts compile-error before grading-begin', async () => {
      const { name, problem } = await fresh();
      const judge = await FakeJudge.online(port, {
        name,
        key: KEY,
        problems: [problem.code],
      });
      const id = await queue(problem._id);
      await judge.next('submission-request');
      judge.send({ name: 'submission-acknowledged', 'submission-id': id });
      judge.send({ name: 'compile-error', 'submission-id': id, log: 'x' });
      await waitUntil(async () => (await submissionRow(id)).status === 'CE');
      await judge.close();
    });

    it('closes a judge that does not acknowledge in time and requeues the submission', async () => {
      const { name, problem } = await fresh();
      const judge = await FakeJudge.online(port, {
        name,
        key: KEY,
        problems: [problem.code],
      });
      const id = await queue(problem._id);
      await judge.next('submission-request');
      await judge.closed;
      await waitUntil(async () => (await submissionRow(id)).requeueCount === 1);
      expect(await submissionRow(id)).toMatchObject({ status: 'QU' });
      const replacement = await FakeJudge.online(port, {
        name,
        key: KEY,
        problems: [problem.code],
      });
      expect(
        (await replacement.next('submission-request'))['submission-id'],
      ).toBe(id);
      await replacement.close();
    });

    it('requeues on a mid-grading disconnect and fails the submission on the second', async () => {
      const { name, problem } = await fresh();
      const id = await queue(problem._id);
      for (const attempt of [1, 2]) {
        const judge = await FakeJudge.online(port, {
          name,
          key: KEY,
          problems: [problem.code],
        });
        expect((await judge.next('submission-request'))['submission-id']).toBe(
          id,
        );
        judge.send({ name: 'submission-acknowledged', 'submission-id': id });
        judge.send({
          name: 'grading-begin',
          'submission-id': id,
          pretested: false,
        });
        await waitUntil(async () => (await submissionRow(id)).status === 'G');
        await judge.close();
        await waitUntil(async () =>
          attempt === 1
            ? (await submissionRow(id)).status === 'QU'
            : (await submissionRow(id)).status === 'IE',
        );
      }
    });

    it('terminates on abort, ends compile errors and internal errors, keeps compiler warnings', async () => {
      const { name, problem } = await fresh();
      const judge = await FakeJudge.online(port, {
        name,
        key: KEY,
        problems: [problem.code],
      });
      const aborted = await queue(problem._id);
      const broken = await queue(problem._id);
      const crashed = await queue(problem._id);
      await judge.next('submission-request');
      judge.send({ name: 'submission-acknowledged', 'submission-id': aborted });
      await commands.publish({ type: 'abort', submissionId: aborted });
      await judge.next('terminate-submission');
      judge.send({ name: 'submission-terminated', 'submission-id': aborted });
      expect((await judge.next('submission-request'))['submission-id']).toBe(
        broken,
      );
      judge.send({ name: 'submission-acknowledged', 'submission-id': broken });
      judge.send({
        name: 'compile-message',
        'submission-id': broken,
        log: 'warning',
      });
      judge.send({
        name: 'compile-error',
        'submission-id': broken,
        log: 'error: ;',
      });
      expect((await judge.next('submission-request'))['submission-id']).toBe(
        crashed,
      );
      judge.send({ name: 'submission-acknowledged', 'submission-id': crashed });
      judge.send({
        name: 'grading-begin',
        'submission-id': crashed,
        pretested: false,
      });
      judge.send({
        name: 'internal-error',
        'submission-id': crashed,
        message: 'Traceback',
      });
      await waitUntil(
        async () => (await submissionRow(crashed)).status === 'IE',
      );
      expect(await submissionRow(aborted)).toMatchObject({
        status: 'AB',
        result: 'AB',
        points: 0,
      });
      expect(await submissionRow(broken)).toMatchObject({
        status: 'CE',
        result: 'CE',
        error: 'error: ;',
      });
      expect(await submissionRow(crashed)).toMatchObject({
        result: 'IE',
        error: 'Traceback',
      });
      expect(
        (await bridge.gradedJobs()).map((job) => job.submissionId),
      ).toEqual(expect.arrayContaining([aborted, broken, crashed]));
      await judge.close();
    });
  });
});
