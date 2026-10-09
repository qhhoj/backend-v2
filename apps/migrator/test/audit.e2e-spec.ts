import { AuditService } from '../src/audit.service';
import { setupMigratorTest } from './setup';

const RAW_HASH = 'deadbeef0123456789abcdef01234567';

describe('audit', () => {
  let harness: Awaited<ReturnType<typeof setupMigratorTest>>;
  let report: { errors: string[]; warnings: string[] };
  let baseline: { errors: string[]; warnings: string[] };

  beforeAll(async () => {
    harness = await setupMigratorTest();
    const audit = harness.testingModule.get(AuditService);
    baseline = await audit.run();
    await harness.mysql.query(
      `SET FOREIGN_KEY_CHECKS=0;
       INSERT INTO ${harness.name}.judge_problem (id, code, name, points, time_limit, memory_limit, group_id) VALUES (990, 'BADCODE', 'x', 50, 1, 65536, 1);
       INSERT INTO ${harness.name}.judge_submission (id, date, status, result, problem_id, user_id, language_id) VALUES (990, NOW(), 'ZZ', 'AC', 99999, 1, 1);
       INSERT INTO ${harness.name}.judge_submissiontestcase (id, status, submission_id) VALUES (990, 'RJ', 990);
       INSERT INTO ${harness.name}.auth_user (id, password, username, email) VALUES (990, '${RAW_HASH}', 'rawhash990', 'rawhash990@example.com');
       INSERT INTO ${harness.name}.judge_commentlock (id, page) VALUES (990, 'p:dup990'), (991, 'p:dup990');
       ALTER TABLE ${harness.name}.judge_license MODIFY \`key\` varchar(20) COLLATE utf8mb4_bin NOT NULL;
       INSERT INTO ${harness.name}.judge_license (id, \`key\`, link, name, display, icon, text) VALUES (990, 'CC990', '', 'A', '', '', ''), (991, 'cc990', '', 'B', '', '', '');`,
    );
    report = await audit.run();
  });

  /** The number in the first error or warning line that starts with `what`; 0 when the check printed nothing. */
  const countOf = (
    from: { errors: string[]; warnings: string[] },
    what: string,
  ): number => {
    const line = [...from.errors, ...from.warnings].find((text) =>
      text.startsWith(`${what}: `),
    );
    return line ? Number(/: (\d+) /.exec(line)![1]) : 0;
  };
  const added = (what: string) =>
    countOf(report, what) - countOf(baseline, what);

  afterAll(() => harness.teardown());

  it('errors on invalid JSON', () =>
    expect(report.errors).toContainEqual(
      expect.stringMatching(
        /judge_contest\.format_config: invalid JSON in 1 row/,
      ),
    ));
  it('warns on zero dates', () =>
    expect(report.warnings).toContainEqual(
      expect.stringMatching(/judge_profile\.data_last_downloaded: 1 zero date/),
    ));
  it('warns on case-only email duplicates by id, never by value', () => {
    expect(report.warnings).toContain(
      'auth_user.email: 1 case-only duplicate group(s): auth_user:2 auth_user:3',
    );
    expect(
      [...report.errors, ...report.warnings].some((line) =>
        line.includes('bob@'),
      ),
    ).toBe(false);
  });
  it('makes a case-only duplicate in a v2 unique column an error, named by id', () =>
    expect(report.errors).toContain(
      'judge_license.key: 1 case-only duplicate group(s): judge_license:990 judge_license:991',
    ));
  it('warns, not errors, on out-of-range points (the problems job clamps them)', () => {
    const label =
      'judge_problem.points outside 800..3500 (clamped by the problems job)';
    expect(added(label)).toBe(1);
    expect(report.errors.some((line) => line.startsWith(label))).toBe(false);
  });
  it('counts RJ test cases that map to IE, without an enum warning', () => {
    expect(added('judge_submissiontestcase.status RJ (mapped to IE)')).toBe(1);
    expect(report.warnings.join('\n')).not.toContain('"RJ"');
  });
  it('never prints a password field that has no recognised algorithm prefix', () => {
    const everything = [...report.errors, ...report.warnings].join('\n');
    expect(everything).not.toContain(RAW_HASH);
    expect(report.warnings).toContainEqual(
      expect.stringMatching(
        /\d+ user\(s\) with unrecognised format passwords must reset/,
      ),
    );
  });
  it('makes rows outside a v2 schema bound errors (the operator decides before the import)', () => {
    expect(added('judge_problem.code outside ^[a-z0-9_]{1,32}$')).toBe(1);
    expect(report.errors).toContainEqual(
      expect.stringMatching(/^judge_problem\.code outside/),
    );
  });
  it('names legacy enum values the v2 schema lacks', () =>
    expect(report.warnings).toContain(
      'judge_submission.status: value "ZZ" not in the v2 enum',
    ));
  it('counts dangling references and duplicate comment-lock pages', () => {
    expect(added('judge_submission.problem_id → judge_problem')).toBe(1);
    expect(
      added('judge_commentlock pages locked twice (later locks skipped)'),
    ).toBe(1);
  });

  it('warns on unsupported password hashes', () =>
    expect(report.warnings).toContainEqual(
      expect.stringMatching(/1 user\(s\) with md5 passwords/),
    ));
  it('reports webauthn credentials', () =>
    expect(report.warnings).toContainEqual(
      expect.stringMatching(/1 legacy WebAuthn credential/),
    ));
});
